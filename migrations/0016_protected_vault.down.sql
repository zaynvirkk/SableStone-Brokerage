BEGIN;
DROP TRIGGER IF EXISTS identity_release_events_no_update_delete ON identity_release_events;
DROP TRIGGER IF EXISTS protected_relationships_no_update_delete ON protected_relationships;
DROP TRIGGER IF EXISTS sealed_identities_no_update_delete ON sealed_identities;
DROP TABLE IF EXISTS identity_release_events;
DROP TABLE IF EXISTS protected_relationships;
DROP TABLE IF EXISTS sealed_identities;
DELETE FROM schema_migrations WHERE version = '0016_protected_vault';
COMMIT;
