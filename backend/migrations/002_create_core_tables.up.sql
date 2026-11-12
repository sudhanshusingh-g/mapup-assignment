-- MapUp Phase 3: core application tables
-- Requires the PostGIS extension. Phase 2 creates it; IF NOT EXISTS is safe here.
-- Apply this migration once, in a transaction.

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

-- This table records the database migration versions applied by this project.
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     BIGINT PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase 2 already enabled PostGIS. Record that baseline for this migration history.
INSERT INTO schema_migrations (version, name)
VALUES (1, 'enable_postgis')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS geofences (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(120) NOT NULL,
    description TEXT,
    boundary    geometry(Polygon, 4326) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT geofences_name_not_blank
        CHECK (LENGTH(BTRIM(name)) > 0),
    CONSTRAINT geofences_boundary_not_empty
        CHECK (NOT ST_IsEmpty(boundary)),
    CONSTRAINT geofences_boundary_is_valid
        CHECK (ST_IsValid(boundary)),
    CONSTRAINT geofences_boundary_has_enough_points
        CHECK (ST_NPoints(ST_ExteriorRing(boundary)) >= 4)
);

CREATE TABLE IF NOT EXISTS vehicles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(120) NOT NULL,
    registration_number VARCHAR(50) NOT NULL UNIQUE,
    metadata            JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT vehicles_name_not_blank
        CHECK (LENGTH(BTRIM(name)) > 0),
    CONSTRAINT vehicles_registration_not_blank
        CHECK (LENGTH(BTRIM(registration_number)) > 0)
);

CREATE TABLE IF NOT EXISTS vehicle_locations (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id  UUID NOT NULL
                REFERENCES vehicles(id) ON DELETE RESTRICT,
    location    geometry(Point, 4326) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT vehicle_locations_point_not_empty
        CHECK (NOT ST_IsEmpty(location)),
    CONSTRAINT vehicle_locations_longitude_range
        CHECK (ST_X(location) BETWEEN -180 AND 180),
    CONSTRAINT vehicle_locations_latitude_range
        CHECK (ST_Y(location) BETWEEN -90 AND 90)
);

CREATE TABLE IF NOT EXISTS alert_configs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    geofence_id UUID NOT NULL
                REFERENCES geofences(id) ON DELETE RESTRICT,
    vehicle_id  UUID
                REFERENCES vehicles(id) ON DELETE RESTRICT,
    event_type  VARCHAR(10) NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT alert_configs_event_type_allowed
        CHECK (event_type IN ('entry', 'exit', 'both'))
);

CREATE TABLE IF NOT EXISTS violations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id  UUID NOT NULL
                REFERENCES vehicles(id) ON DELETE RESTRICT,
    geofence_id UUID NOT NULL
                REFERENCES geofences(id) ON DELETE RESTRICT,
    event_type  VARCHAR(10) NOT NULL,
    location    geometry(Point, 4326) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT violations_event_type_allowed
        CHECK (event_type IN ('entry', 'exit')),
    CONSTRAINT violations_point_not_empty
        CHECK (NOT ST_IsEmpty(location)),
    CONSTRAINT violations_longitude_range
        CHECK (ST_X(location) BETWEEN -180 AND 180),
    CONSTRAINT violations_latitude_range
        CHECK (ST_Y(location) BETWEEN -90 AND 90)
);

CREATE TABLE IF NOT EXISTS alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    violation_id    UUID NOT NULL
                    REFERENCES violations(id) ON DELETE RESTRICT,
    alert_config_id UUID NOT NULL
                    REFERENCES alert_configs(id) ON DELETE RESTRICT,
    payload         JSONB NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    broadcasted_at  TIMESTAMPTZ,

    CONSTRAINT alerts_one_per_violation_and_config
        UNIQUE (violation_id, alert_config_id),
    CONSTRAINT alerts_status_allowed
        CHECK (status IN ('pending', 'broadcasted', 'failed')),
    CONSTRAINT alerts_attempts_non_negative
        CHECK (attempts >= 0),
    CONSTRAINT alerts_payload_is_object
        CHECK (JSONB_TYPEOF(payload) = 'object')
);

-- Spatial indexes: use GiST for geometry search.
CREATE INDEX IF NOT EXISTS idx_geofences_boundary_gist
    ON geofences USING GIST (boundary);

CREATE INDEX IF NOT EXISTS idx_vehicle_locations_location_gist
    ON vehicle_locations USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_violations_location_gist
    ON violations USING GIST (location);

-- B-tree indexes: use these for filtering and ordering.
CREATE INDEX IF NOT EXISTS idx_vehicle_locations_vehicle_recorded
    ON vehicle_locations (vehicle_id, recorded_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_alert_configs_geofence_enabled
    ON alert_configs (geofence_id, enabled);

CREATE INDEX IF NOT EXISTS idx_alert_configs_vehicle_enabled
    ON alert_configs (vehicle_id, enabled);

CREATE INDEX IF NOT EXISTS idx_violations_occurred_at
    ON violations (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_violations_vehicle_occurred
    ON violations (vehicle_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_violations_geofence_occurred
    ON violations (geofence_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_status_created
    ON alerts (status, created_at);

CREATE INDEX IF NOT EXISTS idx_alerts_created_at
    ON alerts (created_at DESC);

INSERT INTO schema_migrations (version, name)
VALUES (2, 'create_core_tables')
ON CONFLICT (version) DO NOTHING;

COMMIT;
