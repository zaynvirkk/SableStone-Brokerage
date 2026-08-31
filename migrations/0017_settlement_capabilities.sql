BEGIN;
CREATE TABLE provider_approvals (
    id uuid PRIMARY KEY,
    provider text NOT NULL,
    environment text NOT NULL CHECK (environment IN ('SANDBOX','PRODUCTION')),
    written_approval_receipt_id uuid NOT NULL REFERENCES authority_receipts(receipt_id),
    actual_use_case text NOT NULL,
    commodity_families jsonb NOT NULL,
    currencies jsonb NOT NULL,
    minimum_gross numeric NOT NULL CHECK (minimum_gross >= 0),
    maximum_gross numeric NOT NULL CHECK (maximum_gross >= minimum_gross),
    capabilities jsonb NOT NULL,
    valid_from timestamptz NOT NULL,
    valid_until timestamptz NOT NULL,
    state text NOT NULL CHECK (state IN ('APPROVED','UNDER_REVIEW','REVOKED')),
    CHECK (valid_until > valid_from)
);
CREATE TABLE provider_capability_snapshots (
    id uuid PRIMARY KEY,
    provider text NOT NULL,
    environment text NOT NULL CHECK (environment IN ('SANDBOX','PRODUCTION')),
    state text NOT NULL CHECK (state IN ('AVAILABLE','UNAVAILABLE','UNDER_REVIEW','DEGRADED','REVOKED')),
    capabilities jsonb NOT NULL,
    approval_id uuid REFERENCES provider_approvals(id),
    reason text NOT NULL,
    evaluated_at timestamptz NOT NULL
);
CREATE TRIGGER provider_approvals_no_update_delete BEFORE UPDATE OR DELETE ON provider_approvals FOR EACH ROW EXECUTE FUNCTION reject_domain_event_mutation();
CREATE TRIGGER provider_capability_snapshots_no_update_delete BEFORE UPDATE OR DELETE ON provider_capability_snapshots FOR EACH ROW EXECUTE FUNCTION reject_domain_event_mutation();
INSERT INTO schema_migrations(version) VALUES ('0017_settlement_capabilities');
COMMIT;
