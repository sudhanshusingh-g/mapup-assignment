package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"mapup-geofencing/internal/config"
	"mapup-geofencing/internal/database"
	"mapup-geofencing/internal/handlers"
	"mapup-geofencing/internal/repository"
	"mapup-geofencing/internal/services"
	"mapup-geofencing/internal/websocket"
)

func main() {
	cfg := config.Load()

	rootCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := database.Connect(rootCtx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	defer pool.Close()

	if err := database.RunMigrations(rootCtx, pool); err != nil {
		log.Fatalf("database migration failed: %v", err)
	}

	geofenceRepo := repository.NewGeofenceRepository(pool)
	vehicleRepo := repository.NewVehicleRepository(pool)
	locationRepo := repository.NewLocationRepository(pool)
	alertRepo := repository.NewAlertRepository(pool)

	wsHub := websocket.NewHub(cfg.AllowedOrigins)
	go wsHub.Run()

	alertService := services.NewAlertService(alertRepo, wsHub, 4, 1024)

	rateLimiter := handlers.NewIPRateLimiter(cfg.RateLimitRPS, cfg.RateLimitBurst)
	defer rateLimiter.Stop()

	healthHandler := handlers.NewHealthHandler(pool)
	geofenceHandler := handlers.NewGeofenceHandler(geofenceRepo)
	vehicleHandler := handlers.NewVehicleHandler(vehicleRepo, locationRepo, alertService)
	alertHandler := handlers.NewAlertHandler(alertRepo)

	router := buildRouter(cfg, healthHandler, geofenceHandler, vehicleHandler, alertHandler, wsHub, rateLimiter)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	serverErr := make(chan error, 1)
	go func() {
		log.Printf("API server listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		log.Printf("received signal %s, shutting down gracefully...", sig)
	case err := <-serverErr:
		log.Fatalf("server error: %v", err)
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}
	alertService.Shutdown(shutdownCtx)
	wsHub.Shutdown()
	log.Println("server stopped cleanly")
}

func buildRouter(
	cfg config.Config,
	healthHandler *handlers.HealthHandler,
	geofenceHandler *handlers.GeofenceHandler,
	vehicleHandler *handlers.VehicleHandler,
	alertHandler *handlers.AlertHandler,
	wsHub *websocket.Hub,
	rateLimiter *handlers.IPRateLimiter,
) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(handlers.CORS(cfg.AllowedOrigins))
	r.Use(handlers.RequestLogger)
	r.Use(handlers.APIKeyAuth(cfg.APIKey))

	r.NotFound(handlers.NotFoundHandler)
	r.MethodNotAllowed(handlers.MethodNotAllowedHandler)

	r.Get("/health", healthHandler.Check)

	r.Post("/geofences", geofenceHandler.Create)
	r.Get("/geofences", geofenceHandler.List)

	r.Post("/vehicles", vehicleHandler.Create)
	r.Get("/vehicles", vehicleHandler.List)
	r.With(rateLimiter.Middleware).Post("/vehicles/location", vehicleHandler.UpdateLocation)
	r.Get("/vehicles/location/{vehicle_id}", vehicleHandler.GetLocation)

	r.Post("/alerts/configure", alertHandler.Configure)
	r.Get("/alerts", alertHandler.List)
	r.Get("/alerts/history", alertHandler.ListRecentEvents)
	r.Delete("/alerts/{alert_id}", alertHandler.Delete)

	r.Get("/violations/history", alertHandler.ListViolations)

	r.Get("/ws/alerts", wsHub.ServeWS)

	return r
}
