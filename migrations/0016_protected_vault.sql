BEGIN;
CREATE TABLE sealed_identities (
    organization_id uuid NOT NULL REFERENCES organizations(id),
    version integer NOT NULL CHECK (version > 0),
    legal_name_ciphertext bytea NOT NULL,
    address_ciphertext bytea NOT NULL,
    contact_ciphertext bytea NOT NULL,
    tax_id_ciphertext bytea NOT NULL,
    bank_details_ciphertext bytea NOT NULL,
    key_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(organization_id, version)
);
CREATE TABLE protected_relationships (
    id uuid PRIMARY KEY,
    supplier_id uuid NOT NULL REFERENCES organizations(id),
    buyer_id uuid NOT NULL REFERENCES organizations(id),
    introduced_at timestamptz NOT NULL,
    protected_until timestamptz NOT NULL,
    commodity_scope jsonb NOT NULL,
    affiliate_scope text NOT NULL,
    qualifying_purchase_definition text NOT NULL,
    commission_type text NOT NULL CHECK (commission_type IN ('PER_KG','FIXED')),
    commission_rate numeric NOT NULL CHECK (commission_rate >= 0),
    currency char(3) NOT NULL,
    supplier_acceptance_id uuid NOT NULL REFERENCES agreement_acceptances(id),
    buyer_acceptance_id uuid NOT NULL REFERENCES agreement_acceptances(id),
    required_settlement_capabilities jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('PROTECTED','EXPIRED','RELEASED','TERMINATED')),
    CHECK (protected_until > introduced_at),
    CHECK (supplier_id <> buyer_id)
);
CREATE TABLE identity_release_events (
    relationship_id uuid PRIMARY KEY REFERENCES protected_relationships(id),
    supplier_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    fee_lock_id uuid NOT NULL,
    authorization_digest text NOT NULL CHECK (authorization_digest ~ '^[0-9a-f]{64}$'),
    released_at timestamptz NOT NULL
);
CREATE TRIGGER sealed_identities_no_update_delete BEFORE UPDATE OR DELETE ON sealed_identities FOR EACH ROW EXECUTE FUNCTION reject_domain_event_mutation();
CREATE TRIGGER protected_relationships_no_update_delete BEFORE UPDATE OR DELETE ON protected_relationships FOR EACH ROW EXECUTE FUNCTION reject_domain_event_mutation();
CREATE TRIGGER identity_release_events_no_update_delete BEFORE UPDATE OR DELETE ON identity_release_events FOR EACH ROW EXECUTE FUNCTION reject_domain_event_mutation();
INSERT INTO schema_migrations(version) VALUES ('0016_protected_vault');
COMMIT;
