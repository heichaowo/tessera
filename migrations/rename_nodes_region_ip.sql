-- Migration: Update node naming and add region-based IP fields
-- Run with: docker exec moenet-postgres psql -U moenet -d moenet -f /path/to/this.sql

-- Step 1: Add legacy_lla column if not exists
ALTER TABLE routers ADD COLUMN IF NOT EXISTS legacy_lla VARCHAR(50);

-- Step 2: Change region_code from VARCHAR to INTEGER (if needed)
-- First drop and recreate if it exists as wrong type
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'routers' AND column_name = 'region_code' 
        AND data_type = 'character varying'
    ) THEN
        ALTER TABLE routers DROP COLUMN region_code;
        ALTER TABLE routers ADD COLUMN region_code INTEGER;
    END IF;
END $$;

-- Step 3: Update node names and set region_code/legacy_lla
-- jp-rr -> jp1 (AS-E = 101)
UPDATE routers SET 
    name = 'jp1', 
    region_code = 101, 
    legacy_lla = 'fe80::998:1',
    node_id = 1
WHERE name = 'jp-rr';

-- jp-edge -> jp2 (AS-E = 101)
UPDATE routers SET 
    name = 'jp2', 
    region_code = 101, 
    legacy_lla = 'fe80::998:2',
    node_id = 2
WHERE name = 'jp-edge';

-- hk-edge -> hk2 (AS-E = 101) - old node_id 3
UPDATE routers SET 
    name = 'hk2', 
    region_code = 101, 
    legacy_lla = 'fe80::998:3',
    node_id = 4
WHERE name = 'hk-edge';

-- hk-rr -> hk1 (AS-E = 101) - old node_id 4
UPDATE routers SET 
    name = 'hk1', 
    region_code = 101, 
    legacy_lla = 'fe80::998:4',
    node_id = 3
WHERE name = 'hk-rr';

-- lax1-rr -> us1 (NA-W = 203)
UPDATE routers SET 
    name = 'us1', 
    region_code = 203, 
    legacy_lla = 'fe80::998:14',
    node_id = 21
WHERE name = 'lax1-rr';

-- lax1-edge -> us2 (NA-W = 203)
UPDATE routers SET 
    name = 'us2', 
    region_code = 203, 
    legacy_lla = 'fe80::998:15',
    node_id = 22
WHERE name = 'lax1-edge';

-- zrh -> ch (EU-C = 302) if exists
UPDATE routers SET 
    name = 'ch', 
    region_code = 302, 
    legacy_lla = NULL,
    node_id = 36
WHERE name = 'zrh';

-- Step 4: Update loopback IPs based on new format
-- IPv4: 172.22.188.{node_id}
-- IPv6: fd00:4242:7777:{region_code}:{regional_node_num}::1

-- APAC nodes (region_code 101)
UPDATE routers SET 
    dn42_loopback4 = '172.22.188.' || node_id,
    dn42_loopback6 = 'fd00:4242:7777:101:' || 
        CASE 
            WHEN name = 'jp1' THEN '1'
            WHEN name = 'jp2' THEN '2'
            WHEN name = 'hk1' THEN '3'
            WHEN name = 'hk2' THEN '4'
        END || '::1'
WHERE region_code = 101;

-- NA nodes (region_code 203)
UPDATE routers SET 
    dn42_loopback4 = '172.22.188.' || node_id,
    dn42_loopback6 = 'fd00:4242:7777:203:' || 
        CASE 
            WHEN name = 'us1' THEN '1'
            WHEN name = 'us2' THEN '2'
        END || '::1'
WHERE region_code = 203;

-- EU nodes (region_code 302)
UPDATE routers SET 
    dn42_loopback4 = '172.22.188.' || node_id,
    dn42_loopback6 = 'fd00:4242:7777:302:1::1'
WHERE region_code = 302;

-- Verify changes
SELECT name, node_id, region_code, legacy_lla, dn42_loopback4, dn42_loopback6 
FROM routers ORDER BY region_code, node_id;
