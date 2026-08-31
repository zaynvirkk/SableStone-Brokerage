BEGIN;
DROP TABLE IF EXISTS organization_candidates;
DROP TABLE IF EXISTS discovery_receipts;
DELETE FROM schema_migrations WHERE version = '0005_discovery';
COMMIT;
