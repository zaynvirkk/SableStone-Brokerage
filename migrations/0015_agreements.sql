BEGIN;
CREATE TABLE agreements (
    id uuid NOT NULL,
    agreement_kind text NOT NULL,
    version text NOT NULL,
    body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
    body_object_key text NOT NULL,
    effective_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    legal_gate_receipt_id uuid NOT NULL REFERENCES authority_receipts(receipt_id),
    seller_of_record text NOT NULL CHECK (seller_of_record = 'SUPPLIER'),
    sablestone_role text NOT NULL CHECK (sablestone_role = 'COMMISSION_BROKER'),
    PRIMARY KEY(id, version),
    CHECK (expires_at > effective_at)
);
CREATE TABLE agreement_acceptances (
    id uuid PRIMARY KEY,
    idempotency_key text NOT NULL UNIQUE,
    agreement_id uuid NOT NULL,
    agreement_version text NOT NULL,
    agreement_body_sha256 text NOT NULL,
    expected_organization_id uuid NOT NULL REFERENCES organizations(id),
    signer_organization_id uuid NOT NULL REFERENCES organizations(id),
    signer_user_id uuid NOT NULL,
    signer_email_verified boolean NOT NULL CHECK (signer_email_verified),
    otp_challenge_id text NOT NULL,
    otp_verified boolean NOT NULL CHECK (otp_verified),
    otp_expires_at timestamptz NOT NULL,
    accepted_at timestamptz NOT NULL,
    ip_address_ciphertext bytea NOT NULL,
    user_agent_digest text NOT NULL CHECK (user_agent_digest ~ '^[0-9a-f]{64}$'),
    acceptance_sha256 text NOT NULL CHECK (acceptance_sha256 ~ '^[0-9a-f]{64}$'),
    FOREIGN KEY(agreement_id, agreement_version) REFERENCES agreements(id, version),
    CHECK (expected_organization_id = signer_organization_id),
    CHECK (accepted_at < otp_expires_at)
);
CREATE TRIGGER agreements_no_update_delete BEFORE UPDATE OR DELETE ON agreements FOR EACH ROW EXECUTE FUNCTION reject_domain_event_mutation();
CREATE TRIGGER agreement_acceptances_no_update_delete BEFORE UPDATE OR DELETE ON agreement_acceptances FOR EACH ROW EXECUTE FUNCTION reject_domain_event_mutation();
INSERT INTO schema_migrations(version) VALUES ('0015_agreements');
COMMIT;
