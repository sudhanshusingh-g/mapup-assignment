-- MapUp Phase 3 schema smoke test.
-- The test runs in a transaction and rolls back its temporary rows at the end.
-- Run only after 002_create_core_tables.up.sql has been applied.

BEGIN;

DO $$
DECLARE
    v_geofence_id UUID;
    v_vehicle_id UUID;
    v_config_id UUID;
    v_violation_id UUID;
    v_inside BOOLEAN;
    v_outside BOOLEAN;
    v_boundary_covered BOOLEAN;
    v_boundary_contained BOOLEAN;
BEGIN
    -- 1. Insert a valid polygon geofence.
    INSERT INTO geofences (name, description, boundary)
    VALUES (
        'Phase 3 temporary test geofence',
        'Created only by the Phase 3 verification script',
        ST_GeomFromText(
            'POLYGON((77.59 12.97, 77.60 12.97, 77.60 12.98, 77.59 12.98, 77.59 12.97))',
            4326
        )
    )
    RETURNING id INTO v_geofence_id;

    -- 2. Insert a vehicle.
    INSERT INTO vehicles (name, registration_number, metadata)
    VALUES (
        'Phase 3 temporary test vehicle',
        'PHASE3-TEST-001',
        '{"source":"phase3-verification"}'::JSONB
    )
    RETURNING id INTO v_vehicle_id;

    -- 3. Store a location sample (PostGIS point order is longitude, latitude).
    INSERT INTO vehicle_locations (vehicle_id, location, recorded_at)
    VALUES (
        v_vehicle_id,
        ST_SetSRID(ST_MakePoint(77.595, 12.975), 4326),
        NOW()
    );

    -- 4. Create an all-vehicles entry alert rule.
    INSERT INTO alert_configs (geofence_id, vehicle_id, event_type, enabled)
    VALUES (v_geofence_id, NULL, 'entry', TRUE)
    RETURNING id INTO v_config_id;

    -- 5. Store a violation and its persisted alert.
    INSERT INTO violations (
        vehicle_id, geofence_id, event_type, location, occurred_at
    )
    VALUES (
        v_vehicle_id,
        v_geofence_id,
        'entry',
        ST_SetSRID(ST_MakePoint(77.595, 12.975), 4326),
        NOW()
    )
    RETURNING id INTO v_violation_id;

    INSERT INTO alerts (violation_id, alert_config_id, payload)
    VALUES (
        v_violation_id,
        v_config_id,
        jsonb_build_object(
            'event_type', 'entry',
            'vehicle_id', v_vehicle_id,
            'geofence_id', v_geofence_id
        )
    );

    -- 6. Verify inside/outside and boundary semantics.
    SELECT ST_Covers(
        boundary,
        ST_SetSRID(ST_MakePoint(77.595, 12.975), 4326)
    )
    INTO v_inside
    FROM geofences
    WHERE id = v_geofence_id;

    SELECT ST_Covers(
        boundary,
        ST_SetSRID(ST_MakePoint(77.61, 12.975), 4326)
    )
    INTO v_outside
    FROM geofences
    WHERE id = v_geofence_id;

    SELECT
        ST_Covers(boundary, ST_SetSRID(ST_MakePoint(77.59, 12.975), 4326)),
        ST_Contains(boundary, ST_SetSRID(ST_MakePoint(77.59, 12.975), 4326))
    INTO v_boundary_covered, v_boundary_contained
    FROM geofences
    WHERE id = v_geofence_id;

    IF v_inside IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'FAIL: expected inside point to be covered';
    END IF;

    IF v_outside IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'FAIL: expected outside point not to be covered';
    END IF;

    IF v_boundary_covered IS DISTINCT FROM TRUE
       OR v_boundary_contained IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'FAIL: unexpected polygon boundary semantics';
    END IF;

    -- 7. Confirm CHECK constraint rejects an invalid event type.
    BEGIN
        INSERT INTO alert_configs (geofence_id, event_type)
        VALUES (v_geofence_id, 'sideways');
        RAISE EXCEPTION 'FAIL: invalid alert event_type was accepted';
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE 'PASS: invalid alert event_type rejected';
    END;

    -- 8. Confirm FK rejects a location for a nonexistent vehicle.
    BEGIN
        INSERT INTO vehicle_locations (vehicle_id, location, recorded_at)
        VALUES (
            '00000000-0000-0000-0000-000000000000',
            ST_SetSRID(ST_MakePoint(77.595, 12.975), 4326),
            NOW()
        );
        RAISE EXCEPTION 'FAIL: nonexistent vehicle foreign key was accepted';
    EXCEPTION
        WHEN foreign_key_violation THEN
            RAISE NOTICE 'PASS: nonexistent vehicle rejected by foreign key';
    END;

    -- 9. Confirm a duplicate alert for the same violation/rule is rejected.
    BEGIN
        INSERT INTO alerts (violation_id, alert_config_id, payload)
        VALUES (v_violation_id, v_config_id, '{"duplicate_test":true}'::JSONB);
        RAISE EXCEPTION 'FAIL: duplicate alert was accepted';
    EXCEPTION
        WHEN unique_violation THEN
            RAISE NOTICE 'PASS: duplicate alert rejected by unique constraint';
    END;

    RAISE NOTICE 'PASS: Phase 3 database smoke tests completed';
END
$$;

-- Undo all temporary test rows, even when the test succeeds.
ROLLBACK;
