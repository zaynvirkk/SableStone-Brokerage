BEGIN;
CREATE TABLE risk_checks (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id),
    check_type text NOT NULL,
    state text NOT NULL CHECK (state IN ('PASS','HIT','UNKNOWN','AMBIGUOUS','EXPIRED','ERROR')),
    source_provider text NOT NULL,
    source_receipt_id uuid NOT NULL,
    source_digest text NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
    checked_at timestamptz NOT NULL,
    valid_until timestamptz NOT NULL,
    matched_entity_ids jsonb NOT NULL,
    policy_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(organization_id, check_type, source_provider, source_digest, policy_version),
    CHECK (valid_until > checked_at)
);
CREATE TABLE risk_decisions (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id),
    state text NOT NULL CHECK (state IN ('PASS','REJECT','FREEZE')),
    reasons jsonb NOT NULL,
    check_ids jsonb NOT NULL,
    policy_version text NOT NULL,
    decided_at timestamptz NOT NULL
);
CREATE TRIGGER risk_checks_no_update_delete BEFORE UPDATE OR DELETE ON risk_checks
FOR EACH ROW EXECUTE FUNCTION reject_domain_event_mutation();
CREATE TRIGGER risk_decisions_no_update_delete BEFORE UPDATE OR DELETE ON risk_decisions
FOR EACH ROW EXECUTE FUNCTION reject_domain_event_mutation();
INSERT INTO schema_migrations(version) VALUES ('0014_risk');
COMMIT;
