# Setup & Testing Guide

## 1. Prerequisites

- **Docker & Docker Compose** (recommended for one-command startup)
- **Go 1.24+** (if running backend locally)
- **Node.js 20+** and **npm** (if running frontend locally)
- **PostgreSQL 16 + PostGIS 3.4** (if running database outside Docker)

---

## 2. Running with Docker Compose (Fresh Clone)

```bash
git clone <your-private-repo-url>
cd mapUp
docker compose up --build
```

This starts three containers:
1. `mapup-postgis` (`postgis/postgis:16-3.4-alpine`) on port `5432`
2. `mapup-backend` (Go API server) on port `8080` — automatically applies embedded SQL migrations (`backend/migrations/001_init.sql`) on startup
3. `mapup-frontend` (React + Nginx) on port `3000`

Verify health:
```bash
curl http://localhost:8080/health
```

---

## 3. Local Development Setup (Without Docker for API/UI)

### Step A: Start PostGIS Database
```bash
docker compose up -d db
```

### Step B: Run Backend API
```bash
cd backend
cp ../.env.example .env   # optional; defaults connect to localhost:5432
go mod download
go run ./cmd/api
```

Run backend unit tests (including race detector where CGO is enabled):
```bash
cd backend
go test -v ./...
# With CGO enabled on Linux/macOS/Docker:
CGO_ENABLED=1 go test -race -v ./...
```

### Step C: Run Frontend App
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`.

---

## 4. Key Architectural & Spatial Design Decisions

1. **Boundary Treatment (`ST_Covers` vs `ST_Contains`)**:
   - PostGIS `ST_Contains(polygon, point)` returns `false` when a point sits strictly on a polygon boundary or vertex.
   - This system uses **`ST_Covers(boundary, point)`** (and a boundary-inclusive segment check in pure Go unit tests), treating points lying exactly on the geofence edge or vertex as **inside** the geofence.
2. **Coordinate Order Conversion (`[lat, lon]` vs `[lon, lat]`)**:
   - All REST API requests/responses and Leaflet UI coordinates use **`[latitude, longitude]`**.
   - PostGIS (`ST_MakePoint`, WKT `POLYGON`, and GeoJSON) requires **`[longitude, latitude]`**. Conversion is encapsulated in `internal/geofence/polygon.go` (`CoordsToWKT`, `GeoJSONToCoords`) and `internal/repository/location_repo.go`.
3. **GiST Spatial Indexing**:
   - `idx_geofences_boundary_gist` (`CREATE INDEX ... USING GIST (boundary)`) performs fast bounding-box pruning before exact polygon containment checks, keeping `POST /vehicles/location` fast as the number of geofences grows.
4. **Entry / Exit State Transitions**:
   - `vehicle_geofence_state` stores the set of geofences each vehicle was last inside.
   - Each `POST /vehicles/location` locks the vehicle row (`SELECT ... FOR UPDATE`), compares previous vs current geofence sets (`DetectTransitions`), records transitions in `violations`, and updates `vehicle_geofence_state`.
   - On a vehicle's very first location update, `previous` is empty, so starting inside a geofence emits an `entry` event.
5. **Non-blocking Async Alert Delivery**:
   - After committing the location transaction, detected transition events are pushed onto a buffered channel (`AlertService.Enqueue`) and the HTTP response returns immediately.
   - Background worker goroutines match events against `alert_rules`, persist triggered alerts to `alert_events`, and broadcast JSON payloads through the WebSocket `Hub` (`internal/websocket/hub.go`).

---

## 5. API Testing Guide (`curl`)

### 1. Create Geofences (`POST /geofences`)
```bash
curl -s -X POST http://localhost:8080/geofences \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Downtown Delivery Zone",
    "description": "Main delivery area for downtown customers",
    "coordinates": [
      [37.7749, -122.4194],
      [37.7849, -122.4194],
      [37.7849, -122.4094],
      [37.7749, -122.4094],
      [37.7749, -122.4194]
    ],
    "category": "delivery_zone"
  }'
```

Test invalid geofence validation (unclosed polygon returns `400` with `time_ns`):
```bash
curl -i -X POST http://localhost:8080/geofences \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Invalid Zone",
    "coordinates": [[37.77,-122.41],[37.78,-122.41],[37.78,-122.40],[37.77,-122.40]],
    "category": "delivery_zone"
  }'
```

### 2. List Geofences (`GET /geofences`)
```bash
curl -s "http://localhost:8080/geofences?category=delivery_zone"
```

### 3. Register a Vehicle (`POST /vehicles`)
```bash
curl -s -X POST http://localhost:8080/vehicles \
  -H "Content-Type: application/json" \
  -d '{
    "vehicle_number": "KA-01-AB-1234",
    "driver_name": "John Doe",
    "vehicle_type": "truck",
    "phone": "+1234567890"
  }'
```

### 4. List Vehicles (`GET /vehicles`)
```bash
curl -s http://localhost:8080/vehicles
```

### 5. Configure Alert Rule (`POST /alerts/configure`)
Replace `GEO_ID` and `VEH_ID` with the IDs returned above (omit `vehicle_id` to monitor all vehicles):
```bash
curl -s -X POST http://localhost:8080/alerts/configure \
  -H "Content-Type: application/json" \
  -d '{
    "geofence_id": "GEO_ID",
    "vehicle_id": "VEH_ID",
    "event_type": "both"
  }'
```

### 6. List Alert Rules (`GET /alerts`)
```bash
curl -s "http://localhost:8080/alerts?geofence_id=GEO_ID"
```

### 7. Update Vehicle Location (`POST /vehicles/location`)
Move inside geofence (triggers `entry` event + real-time WebSocket alert):
```bash
curl -s -X POST http://localhost:8080/vehicles/location \
  -H "Content-Type: application/json" \
  -d '{
    "vehicle_id": "VEH_ID",
    "latitude": 37.7800,
    "longitude": -122.4140,
    "timestamp": "2025-01-15T10:35:00Z"
  }'
```

Move outside geofence (triggers `exit` event + real-time WebSocket alert):
```bash
curl -s -X POST http://localhost:8080/vehicles/location \
  -H "Content-Type: application/json" \
  -d '{
    "vehicle_id": "VEH_ID",
    "latitude": 37.8000,
    "longitude": -122.4500,
    "timestamp": "2025-01-15T10:40:00Z"
  }'
```

### 8. Get Vehicle Location (`GET /vehicles/location/{vehicle_id}`)
```bash
curl -s http://localhost:8080/vehicles/location/VEH_ID
```

### 9. Query Violation History (`GET /violations/history`)
```bash
curl -s "http://localhost:8080/violations/history?vehicle_id=VEH_ID&limit=50"
```

### 10. Test WebSocket Real-time Stream (`/ws/alerts`)
Using `wscat` (`npm install -g wscat`):
```bash
wscat -c ws://localhost:8080/ws/alerts
```

---

## 6. Frontend Usage Guide

1. **Create a Geofence**: Open **Live Operations** -> click **Draw Geofence** on the map toolbar -> click 3+ corners on the map -> click **Use Polygon** -> enter name & category -> click **Save Geofence**.
2. **Register & Track Vehicle**: Switch to the **Vehicles** tab -> register a vehicle -> select it in **Update Vehicle Location** -> click **Pick on Map** and click anywhere on the map (or click **Simulate Entry/Exit**).
3. **Configure Alerts**: Open **Alert Rules** -> select a geofence, optional vehicle (or *All Registered Vehicles*), and event type (`entry`, `exit`, `both`).
4. **Live Alerts**: Open two browser tabs side by side; moving a vehicle across a monitored geofence delivers toast alerts and updates the **Live Alerts** feed in both tabs simultaneously.
5. **Violation History**: Open **Violation History** to filter by vehicle, geofence, and ISO date range with pagination controls.

---

## 7. Docker Hub & Cloud Deployment

### Push Backend Image to Docker Hub
```bash
docker build -t <dockerhub-username>/mapup-geofencing-backend:latest ./backend
docker push <dockerhub-username>/mapup-geofencing-backend:latest
```

### Cloud Deployment Environment Variables
- **Backend** (Render / Railway / Fly.io):
  - `DATABASE_URL`: Managed PostGIS PostgreSQL URL (e.g. Neon / Supabase / Railway PostGIS)
  - `ALLOWED_ORIGINS`: `https://<your-frontend-domain>`
  - `PORT`: `8080`
- **Frontend** (Vercel / Netlify / Cloudflare Pages):
  - Root directory: `frontend`
  - Build command: `npm run build`
  - Output directory: `dist`
  - Environment variable: `VITE_API_URL=https://<your-backend-domain>` (the frontend automatically uses `wss://` when `VITE_API_URL` is `https://`).
