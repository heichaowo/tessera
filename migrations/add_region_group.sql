-- Migration: Add region_group for regional iBGP topology
-- Run this on production database before deploying new code

-- Add region_group column for regional grouping (apac, na, eu)
ALTER TABLE routers ADD COLUMN IF NOT EXISTS region_group VARCHAR(10);

-- Update node_type: rename 'edge' to 'client' for clarity
UPDATE routers SET node_type = 'client' WHERE node_type = 'edge';

-- Set region_group based on existing region field
-- APAC: JP, HK, SG regions
UPDATE routers SET region_group = 'apac' WHERE region IN ('JP', 'HK', 'SG', 'TW', 'KR');
-- NA: US regions
UPDATE routers SET region_group = 'na' WHERE region IN ('US', 'CA');
-- EU: European regions
UPDATE routers SET region_group = 'eu' WHERE region IN ('DE', 'NL', 'FR', 'UK', 'CH');

-- Add index for region_group queries
CREATE INDEX IF NOT EXISTS idx_routers_region_group ON routers(region_group);
