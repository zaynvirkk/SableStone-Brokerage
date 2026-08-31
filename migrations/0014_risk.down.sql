BEGIN;
DROP TRIGGER IF EXISTS risk_decisions_no_update_delete ON risk_decisions;
DROP TRIGGER IF EXISTS risk_checks_no_update_delete ON risk_checks;
DROP TABLE IF EXISTS risk_decisions;
DROP TABLE IF EXISTS risk_checks;
DELETE FROM schema_migrations WHERE version = '0014_risk';
COMMIT;
