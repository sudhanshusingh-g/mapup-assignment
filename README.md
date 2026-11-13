# MapUp Geofencing & Real-time Alert System

A full-stack geofencing, vehicle tracking, and real-time alert notification platform built with **Go**, **PostgreSQL + PostGIS**, **Gorilla WebSockets**, and **React + TypeScript + Leaflet**.

> **Walkthrough Video**: _Add your 30–45 minute screen recording link here before submission._

## Key Features

- **PostGIS Spatial Engine**: Polygon geofences stored in `geometry(Polygon, 4326)` with a **GiST spatial index** and boundary-inclusive `ST_Covers` point-in-polygon evaluation.
- **Coordinate Safety**: Explicit conversion between API `[latitude, longitude]` arrays and PostGIS `[longitude, latitude]` WKT/GeoJSON pairs.
- **Stateful Entry / Exit Transitions**: Per-vehicle geofence membership tracking (`vehicle_geofence_state`) inside row-locked PostgreSQL transactions detects exact `entry` and `exit` state transitions (including a vehicle's first location update).
- **Non-blocking Real-time Alert Pipeline**: Location updates return immediately while a buffered asynchronous worker pool evaluates alert rules, persists triggered alerts to `alert_events`, and broadcasts over `/ws/alerts` to all connected clients.
- **Strict Nanosecond Telemetry**: Every REST response (including validation and error responses) reports `time_ns` measured inside each handler.
- **Interactive React + Leaflet Dashboard**: Draw polygons directly on the map, click to move vehicles, simulate entry/exit crossings, configure alert rules, view live toast notifications + alert streams, and filter/paginate violation history.

## Project Structure

```text
├── backend/
│   ├── cmd/api/main.go               # Server wiring, router, graceful shutdown
│   ├── internal/
│   │   ├── config/config.go          # Environment configuration
│   │   ├── database/postgres.go      # pgxpool connection & embedded SQL migrations
│   │   ├── geofence/polygon.go       # Polygon validation, WKT/GeoJSON conversion, ray-casting, transitions
│   │   ├── handlers/                 # HTTP handlers, CORS, rate limiter, time_ns response helpers
│   │   ├── models/models.go          # Request/Response DTOs and domain structs
│   │   ├── repository/               # PostGIS & PostgreSQL queries
│   │   ├── services/alert_service.go # Async worker pool for rule matching & alert persistence
│   │   └── websocket/hub.go          # Gorilla WebSocket Hub pattern with heartbeats
│   ├── migrations/001_init.sql       # PostGIS schema, GiST & B-tree indexes
│   └── Dockerfile                    # Multi-stage Go build -> minimal Alpine image
├── frontend/
│   ├── src/
│   │   ├── components/               # MapWorkspace, GeofencePanel, VehiclePanel, AlertRules, History, Toasts
│   │   ├── hooks/useAlertsWebSocket.ts # Auto-reconnecting ws/wss WebSocket hook
│   │   ├── services/api.ts           # Typed REST API client
│   │   ├── types/api.ts              # TypeScript API models
│   │   └── utils/geo.ts              # Category styles, formatting, polygon helpers
│   ├── Dockerfile                    # Multi-stage Vite build -> Nginx static server
│   └── nginx.conf
├── docker-compose.yml
├── SETUP.md
└── README.md
```

## Quick Start (Docker Compose)

```bash
docker compose up --build
```

- Frontend Dashboard: `http://localhost:3000`
- Backend REST API: `http://localhost:8080`
- WebSocket Alerts: `ws://localhost:8080/ws/alerts`
- Health Check: `http://localhost:8080/health`

See [SETUP.md](./SETUP.md) for local development setup, architecture design decisions, API `curl` examples, and deployment instructions.
