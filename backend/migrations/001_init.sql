-- Enable PostGIS spatial extension for geometry types, GiST indexes, and ST_Covers queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Geofences table
-- Coordinates are stored in PostGIS geometry(Polygon, 4326) with [longitude, latitude] order
-- (WGS 84 / SRID 4326). The API layer converts between [latitude, longitude] and [longitude, latitude].
CREATE TABLE IF NOT EXISTS geofences (
    id          VARCHAR(64) PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category    VARCHAR(50) NOT NULL CHECK (category IN ('delivery_zone', 'restricted_zone', 'toll_zone', 'customer_area')),
    boundary    geometry(Polygon, 4326) NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- GiST spatial index accelerates point-in-polygon lookups (ST_Covers) via bounding-box pruning
CREATE INDEX IF NOT EXISTS idx_geofences_boundary_gist ON geofences USING GIST (boundary);
CREATE INDEX IF NOT EXISTS idx_geofences_category ON geofences (category);
CREATE INDEX IF NOT EXISTS idx_geofences_status ON geofences (status);

-- 2. Vehicles table
CREATE TABLE IF NOT EXISTS vehicles (
    id                VARCHAR(64) PRIMARY KEY,
    vehicle_number    VARCHAR(64) NOT NULL UNIQUE,
    driver_name       VARCHAR(255) NOT NULL,
    vehicle_type      VARCHAR(64) NOT NULL,
    phone             VARCHAR(32) NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'active',
    current_latitude  DOUBLE PRECISION,
    current_longitude DOUBLE PRECISION,
    last_location_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Historical vehicle location updates
CREATE TABLE IF NOT EXISTS vehicle_locations (
    id          VARCHAR(64) PRIMARY KEY,
    vehicle_id  VARCHAR(64) NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    location    geometry(Point, 4326) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_locations_vehicle_time
    ON vehicle_locations (vehicle_id, recorded_at DESC);

-- 4. Current geofence membership state per vehicle (used for entry/exit set comparison)
CREATE TABLE IF NOT EXISTS vehicle_geofence_state (
    vehicle_id  VARCHAR(64) NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    geofence_id VARCHAR(64) NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    entered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (vehicle_id, geofence_id)
);

-- 5. Alert rule configurations
-- vehicle_id NULL means the rule applies to all vehicles.
CREATE TABLE IF NOT EXISTS alert_rules (
    id          VARCHAR(64) PRIMARY KEY,
    geofence_id VARCHAR(64) NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    vehicle_id  VARCHAR(64) REFERENCES vehicles(id) ON DELETE CASCADE,
    event_type  VARCHAR(16) NOT NULL CHECK (event_type IN ('entry', 'exit', 'both')),
    status      VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_geofence_status ON alert_rules (geofence_id, status);
CREATE INDEX IF NOT EXISTS idx_alert_rules_vehicle ON alert_rules (vehicle_id);

-- 6. Historical geofence entry/exit events (violations history)
CREATE TABLE IF NOT EXISTS violations (
    id          VARCHAR(64) PRIMARY KEY,
    vehicle_id  VARCHAR(64) NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    geofence_id VARCHAR(64) NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    event_type  VARCHAR(16) NOT NULL CHECK (event_type IN ('entry', 'exit')),
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_violations_vehicle_time ON violations (vehicle_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_violations_geofence_time ON violations (geofence_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_violations_recorded_at ON violations (recorded_at DESC);

-- 7. Triggered real-time alert log (every delivered alert persisted for audit/history)
CREATE TABLE IF NOT EXISTS alert_events (
    id            VARCHAR(64) PRIMARY KEY,
    alert_rule_id VARCHAR(64) REFERENCES alert_rules(id) ON DELETE SET NULL,
    violation_id  VARCHAR(64) REFERENCES violations(id) ON DELETE CASCADE,
    vehicle_id    VARCHAR(64) NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    geofence_id   VARCHAR(64) NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    event_type    VARCHAR(16) NOT NULL CHECK (event_type IN ('entry', 'exit')),
    latitude      DOUBLE PRECISION NOT NULL,
    longitude     DOUBLE PRECISION NOT NULL,
    payload       JSONB NOT NULL,
    occurred_at   TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_events_occurred_at ON alert_events (occurred_at DESC);
