BEGIN;
DROP TRIGGER IF EXISTS agreement_acceptances_no_update_delete ON agreement_acceptances;
DROP TRIGGER IF EXISTS agreements_no_update_delete ON agreements;
DROP TABLE IF EXISTS agreement_acceptances;
DROP TABLE IF EXISTS agreements;
DELETE FROM schema_migrations WHERE version = '0015_agreements';
COMMIT;
