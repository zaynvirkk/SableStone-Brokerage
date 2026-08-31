BEGIN;
DROP TRIGGER IF EXISTS global_suppressions_no_update_delete ON global_suppressions;
DROP TABLE IF EXISTS global_suppressions;
DROP TABLE IF EXISTS contacts;
DELETE FROM schema_migrations WHERE version = '0006_contacts';
COMMIT;
