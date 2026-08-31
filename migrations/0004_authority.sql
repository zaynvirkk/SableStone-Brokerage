BEGIN;
CREATE TABLE authority_receipts (
    receipt_id uuid PRIMARY KEY,
    authority_kind text NOT NULL,
    canonical_url text NOT NULL CHECK (canonical_url ~ '^https://'),
    retrieved_at timestamptz NOT NULL,
    body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
    body_object_key text NOT NULL,
    jurisdiction text NOT NULL,
    proposition text NOT NULL,
    effective_at timestamptz NOT NULL,
    review_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    reviewed_by text NOT NULL,
    source_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (review_at >= retrieved_at),
    CHECK (expires_at > review_at)
);
CREATE TABLE capability_gates (
    gate_name text PRIMARY KEY,
    state text NOT NULL CHECK (state IN ('AVAILABLE','UNAVAILABLE','UNDER_REVIEW','DEGRADED','REVOKED')),
    authority_receipt_id uuid REFERENCES authority_receipts(receipt_id),
    evaluated_at timestamptz NOT NULL,
    reason text NOT NULL,
    CHECK ((state = 'AVAILABLE' AND authority_receipt_id IS NOT NULL) OR state <> 'AVAILABLE')
);
CREATE TRIGGER authority_receipts_no_update_delete
BEFORE UPDATE OR DELETE ON authority_receipts
FOR EACH ROW EXECUTE FUNCTION reject_domain_event_mutation();
INSERT INTO schema_migrations(version) VALUES ('0004_authority');
COMMIT;
