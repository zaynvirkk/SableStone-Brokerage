BEGIN;
DROP TABLE IF EXISTS transactional_outbox;
DROP TABLE IF EXISTS durable_inbox;
DELETE FROM schema_migrations WHERE version = '0001_platform';
DROP TABLE IF EXISTS schema_migrations;
COMMIT;
