BEGIN;
ALTER TABLE identity_release_events DROP CONSTRAINT IF EXISTS identity_release_fee_lock_fk;
DROP TRIGGER IF EXISTS fee_locks_no_update_delete ON fee_locks;
DROP TABLE IF EXISTS fee_locks;
DELETE FROM schema_migrations WHERE version = '0019_fee_locks';
COMMIT;
