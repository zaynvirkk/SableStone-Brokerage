BEGIN;
DROP TABLE IF EXISTS outbound_messages;
DROP TABLE IF EXISTS provider_cursors;
DROP TABLE IF EXISTS communications;
DELETE FROM schema_migrations WHERE version = '0007_email';
COMMIT;
