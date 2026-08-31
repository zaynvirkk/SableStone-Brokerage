BEGIN;
CREATE TABLE contacts (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id),
    normalized_email_ciphertext bytea NOT NULL,
    email_lookup_hash text NOT NULL,
    source text NOT NULL,
    source_receipt_id uuid NOT NULL REFERENCES discovery_receipts(id),
    verification text NOT NULL CHECK (verification IN ('VERIFIED','UNVERIFIED','RISKY','BOUNCED')),
    verified_at timestamptz,
    lawful_basis_policy_version text NOT NULL,
    jurisdiction text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(organization_id, email_lookup_hash),
    CHECK ((verification = 'VERIFIED' AND verified_at IS NOT NULL) OR verification <> 'VERIFIED')
);
CREATE TABLE global_suppressions (
    email_lookup_hash text PRIMARY KEY,
    reason text NOT NULL CHECK (reason IN ('UNSUBSCRIBE','BOUNCE','COMPLAINT','LEGAL','OPERATOR')),
    source_event_id uuid NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE TRIGGER global_suppressions_no_update_delete
BEFORE UPDATE OR DELETE ON global_suppressions
FOR EACH ROW EXECUTE FUNCTION reject_domain_event_mutation();
INSERT INTO schema_migrations(version) VALUES ('0006_contacts');
COMMIT;
