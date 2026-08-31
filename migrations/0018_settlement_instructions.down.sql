BEGIN;
DROP TABLE IF EXISTS settlement_provider_events;
DROP TABLE IF EXISTS settlement_instructions;
DELETE FROM schema_migrations WHERE version = '0018_settlement_instructions';
COMMIT;
