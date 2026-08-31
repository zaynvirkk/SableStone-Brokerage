BEGIN;
DROP TABLE IF EXISTS pricing_decisions;
DROP TABLE IF EXISTS pricing_policies;
DELETE FROM schema_migrations WHERE version = '0012_pricing';
COMMIT;
