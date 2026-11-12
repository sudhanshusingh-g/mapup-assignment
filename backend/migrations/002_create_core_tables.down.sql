-- MapUp Phase 3 rollback.
-- WARNING: this removes all Phase 3 application tables and their data.
-- Do not run against a database whose data you need to keep.

BEGIN;

DROP TABLE IF EXISTS alerts;
DROP TABLE IF EXISTS violations;
DROP TABLE IF EXISTS alert_configs;
DROP TABLE IF EXISTS vehicle_locations;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS geofences;

DELETE FROM schema_migrations
WHERE version = 2;

-- Keep schema_migrations and the PostGIS extension. Phase 2 owns PostGIS setup.

COMMIT;
