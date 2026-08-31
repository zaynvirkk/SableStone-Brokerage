BEGIN;
CREATE TABLE pricing_policies (
    id uuid NOT NULL,
    version text NOT NULL,
    currency char(3) NOT NULL,
    commission_floor_per_kg numeric NOT NULL CHECK (commission_floor_per_kg >= 0),
    surplus_capture_rate numeric NOT NULL CHECK (surplus_capture_rate >= 0 AND surplus_capture_rate <= 1),
    hard_commission_cap_per_kg numeric NOT NULL CHECK (hard_commission_cap_per_kg >= commission_floor_per_kg),
    valid_from timestamptz NOT NULL,
    valid_until timestamptz NOT NULL,
    approval_receipt_id uuid NOT NULL REFERENCES authority_receipts(receipt_id),
    evidence_state text NOT NULL CHECK (evidence_state IN ('HYPOTHESIS','CALIBRATED')),
    PRIMARY KEY(id, version),
    CHECK (valid_until > valid_from)
);
CREATE TABLE pricing_decisions (
    match_id uuid PRIMARY KEY REFERENCES matches(id),
    policy_id uuid NOT NULL,
    policy_version text NOT NULL,
    state text NOT NULL CHECK (state IN ('EXECUTABLE','REJECTED','UNKNOWN')),
    available_surplus_per_kg numeric,
    commission_per_kg numeric,
    buyer_executable_price_per_kg numeric,
    currency char(3),
    reasons jsonb NOT NULL,
    calculated_at timestamptz NOT NULL,
    FOREIGN KEY(policy_id, policy_version) REFERENCES pricing_policies(id, version),
    CHECK ((state = 'EXECUTABLE' AND commission_per_kg IS NOT NULL AND buyer_executable_price_per_kg IS NOT NULL) OR state <> 'EXECUTABLE')
);
INSERT INTO schema_migrations(version) VALUES ('0012_pricing');
COMMIT;
