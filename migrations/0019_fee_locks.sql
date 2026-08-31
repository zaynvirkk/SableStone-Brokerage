BEGIN;
CREATE TABLE fee_locks (
    id uuid PRIMARY KEY,
    trade_id uuid NOT NULL UNIQUE,
    relationship_id uuid NOT NULL REFERENCES protected_relationships(id),
    instruction_id uuid NOT NULL UNIQUE REFERENCES settlement_instructions(id),
    provider text NOT NULL,
    provider_approval_id uuid NOT NULL REFERENCES provider_approvals(id),
    provider_reference text NOT NULL UNIQUE,
    instruction_digest text NOT NULL CHECK (instruction_digest ~ '^[0-9a-f]{64}$'),
    supplier_accepted_instruction_digest text NOT NULL,
    buyer_accepted_instruction_digest text NOT NULL,
    supplier_entitlement numeric NOT NULL CHECK (supplier_entitlement >= 0),
    sablestone_entitlement numeric NOT NULL CHECK (sablestone_entitlement > 0),
    gross_amount numeric NOT NULL CHECK (gross_amount > 0),
    currency char(3) NOT NULL,
    state text NOT NULL CHECK (state = 'LOCKED'),
    created_at timestamptz NOT NULL,
    CHECK (instruction_digest = supplier_accepted_instruction_digest AND instruction_digest = buyer_accepted_instruction_digest)
);
CREATE TRIGGER fee_locks_no_update_delete BEFORE UPDATE OR DELETE ON fee_locks FOR EACH ROW EXECUTE FUNCTION reject_domain_event_mutation();
ALTER TABLE identity_release_events ADD CONSTRAINT identity_release_fee_lock_fk FOREIGN KEY(fee_lock_id) REFERENCES fee_locks(id);
INSERT INTO schema_migrations(version) VALUES ('0019_fee_locks');
COMMIT;
