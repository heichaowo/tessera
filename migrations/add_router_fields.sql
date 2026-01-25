-- Migration: Add last_seen and node_type to routers table
-- Run this on production database before deploying new code

ALTER TABLE routers ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
ALTER TABLE routers ADD COLUMN IF NOT EXISTS node_type VARCHAR(10);

-- Optional: Set node_type for existing nodes based on naming convention
UPDATE routers SET node_type = 'rr' WHERE name LIKE '%-rr%';
UPDATE routers SET node_type = 'edge' WHERE name LIKE '%-edge%' AND node_type IS NULL;
