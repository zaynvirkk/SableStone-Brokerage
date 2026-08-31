BEGIN;
DROP TABLE IF EXISTS trade_state;
DROP TRIGGER IF EXISTS domain_events_no_update_delete ON domain_events;
DROP FUNCTION IF EXISTS reject_domain_event_mutation;
DROP TABLE IF EXISTS domain_events;
DELETE FROM schema_migrations WHERE version = '0003_lifecycle';
COMMIT;
