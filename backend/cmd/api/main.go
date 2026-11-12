package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	ctx, cancel := context.WithTimeout(
		context.Background(),
		10*time.Second,
	)
	defer cancel()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatal("Could not create database pool: ", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		log.Fatal("Could not connect to database: ", err)
	}

	log.Println("Connected to PostgreSQL successfully")

	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery(), corsMiddleware())

	router.GET("/health", func(c *gin.Context) {
		started := time.Now()

		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
			"time_ns": strconv.FormatInt(
				time.Since(started).Nanoseconds(), 10,
			),
		})
	})

	router.GET("/health/db", func(c *gin.Context) {
		started := time.Now()

		queryCtx, queryCancel := context.WithTimeout(
			c.Request.Context(),
			3*time.Second,
		)
		defer queryCancel()

		var version string
		err := pool.QueryRow(
			queryCtx,
			"SELECT PostGIS_Full_Version()",
		).Scan(&version)

		elapsed := strconv.FormatInt(
			time.Since(started).Nanoseconds(), 10,
		)

		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"status":  "error",
				"error":   "Database check failed",
				"time_ns": elapsed,
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":          "connected",
			"postgis_version": version,
			"time_ns":         elapsed,
		})
	})

	log.Println("Backend running at http://localhost:8080")

	if err := router.Run(":8080"); err != nil {
		log.Fatal("Server failed: ", err)
	}
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")

		if origin == "http://localhost:5173" {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
		}

		c.Header(
			"Access-Control-Allow-Headers",
			"Content-Type, Authorization",
		)
		c.Header(
			"Access-Control-Allow-Methods",
			"GET, POST, PUT, PATCH, DELETE, OPTIONS",
		)

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
