BEGIN;
DROP TRIGGER IF EXISTS provider_capability_snapshots_no_update_delete ON provider_capability_snapshots;
DROP TRIGGER IF EXISTS provider_approvals_no_update_delete ON provider_approvals;
DROP TABLE IF EXISTS provider_capability_snapshots;
DROP TABLE IF EXISTS provider_approvals;
DELETE FROM schema_migrations WHERE version = '0017_settlement_capabilities';
COMMIT;
