BEGIN;
DROP TABLE IF EXISTS inventory_refreshes;
DROP TABLE IF EXISTS qualification_decisions;
DROP TABLE IF EXISTS document_checks;
DELETE FROM schema_migrations WHERE version = '0009_qualification';
COMMIT;
