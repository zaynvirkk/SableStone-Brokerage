BEGIN;
DROP TABLE IF EXISTS negotiation_decisions;
DROP TABLE IF EXISTS negotiations;
DELETE FROM schema_migrations WHERE version = '0013_negotiations';
COMMIT;
