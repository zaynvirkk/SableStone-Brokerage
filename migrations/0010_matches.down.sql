BEGIN;
DROP TABLE IF EXISTS matches;
DELETE FROM schema_migrations WHERE version = '0010_matches';
COMMIT;
