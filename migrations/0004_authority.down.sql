BEGIN;
DROP TABLE IF EXISTS capability_gates;
DROP TRIGGER IF EXISTS authority_receipts_no_update_delete ON authority_receipts;
DROP TABLE IF EXISTS authority_receipts;
DELETE FROM schema_migrations WHERE version = '0004_authority';
COMMIT;
