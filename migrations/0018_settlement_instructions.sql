BEGIN;
CREATE TABLE settlement_instructions (
    id uuid PRIMARY KEY,
    trade_id uuid NOT NULL,
    provider text NOT NULL,
    environment text NOT NULL CHECK (environment IN ('SANDBOX','PRODUCTION')),
    commodity_family text NOT NULL,
    buyer_id uuid NOT NULL REFERENCES organizations(id),
    supplier_id uuid NOT NULL REFERENCES organizations(id),
    sablestone_beneficiary_id uuid NOT NULL REFERENCES organizations(id),
    currency char(3) NOT NULL,
    gross_amount numeric NOT NULL CHECK (gross_amount >= 0),
    supplier_entitlement numeric NOT NULL CHECK (supplier_entitlement >= 0),
    sablestone_entitlement numeric NOT NULL CHECK (sablestone_entitlement > 0),
    other_allocations jsonb NOT NULL,
    release_conditions jsonb NOT NULL,
    dispute_procedure text NOT NULL,
    expires_at timestamptz NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    provider_reference text,
    acknowledged boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (buyer_id <> supplier_id AND buyer_id <> sablestone_beneficiary_id AND supplier_id <> sablestone_beneficiary_id)
);
CREATE TABLE settlement_provider_events (
    provider text NOT NULL,
    external_event_id text NOT NULL,
    provider_reference text NOT NULL,
    event_type text NOT NULL,
    occurred_at timestamptz NOT NULL,
    payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
    signature_verified boolean NOT NULL CHECK (signature_verified),
    processed_at timestamptz,
    PRIMARY KEY(provider, external_event_id)
);
INSERT INTO schema_migrations(version) VALUES ('0018_settlement_instructions');
COMMIT;
