BEGIN;
CREATE TABLE cost_components (
    id uuid PRIMARY KEY,
    match_id uuid NOT NULL REFERENCES matches(id),
    cost_kind text NOT NULL,
    amount_per_kg numeric CHECK (amount_per_kg >= 0),
    currency char(3) NOT NULL,
    evidence text NOT NULL CHECK (evidence IN ('FIRM','ESTIMATE','UNKNOWN')),
    source_receipt_id uuid,
    valid_until timestamptz,
    basis text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(match_id, cost_kind),
    CHECK ((evidence = 'FIRM' AND amount_per_kg IS NOT NULL AND source_receipt_id IS NOT NULL AND valid_until IS NOT NULL) OR evidence <> 'FIRM')
);
CREATE TABLE economic_floors (
    match_id uuid PRIMARY KEY REFERENCES matches(id),
    state text NOT NULL CHECK (state IN ('KNOWN','UNKNOWN')),
    amount_per_kg numeric CHECK (amount_per_kg >= 0),
    currency char(3),
    component_digest text,
    reasons jsonb NOT NULL,
    calculated_at timestamptz NOT NULL,
    CHECK ((state = 'KNOWN' AND amount_per_kg IS NOT NULL AND currency IS NOT NULL AND component_digest IS NOT NULL) OR state = 'UNKNOWN')
);
INSERT INTO schema_migrations(version) VALUES ('0011_costs');
COMMIT;
