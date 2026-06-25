-- Add per-node operator wallet for x402 peering settlement (Arc Testnet).
-- Dev auto-syncs via sequelize.sync({ alter: true }); this covers production.
ALTER TABLE routers ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(42);
