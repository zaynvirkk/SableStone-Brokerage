BEGIN;
DROP TABLE IF EXISTS attachment_checks;
DROP TABLE IF EXISTS extraction_proposals;
DELETE FROM schema_migrations WHERE version = '0008_extraction';
COMMIT;
