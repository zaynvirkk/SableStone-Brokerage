BEGIN;
CREATE TABLE negotiations (
    id uuid PRIMARY KEY,
    revision integer NOT NULL CHECK (revision >= 0),
    match_id uuid NOT NULL REFERENCES matches(id),
    offer_version integer NOT NULL,
    demand_version integer NOT NULL,
    pricing_policy_id uuid NOT NULL,
    pricing_policy_version text NOT NULL,
    current_quote_per_kg numeric NOT NULL CHECK (current_quote_per_kg >= 0),
    currency char(3) NOT NULL,
    status text NOT NULL CHECK (status IN ('OPEN','ACCEPTED','DECLINED','EXPIRED')),
    expires_at timestamptz NOT NULL,
    last_event_id uuid NOT NULL REFERENCES domain_events(event_id),
    FOREIGN KEY(pricing_policy_id, pricing_policy_version) REFERENCES pricing_policies(id, version),
    UNIQUE(id, revision)
);
CREATE TABLE negotiation_decisions (
    id uuid PRIMARY KEY,
    negotiation_id uuid NOT NULL,
    session_revision integer NOT NULL,
    intent_digest text NOT NULL CHECK (intent_digest ~ '^[0-9a-f]{64}$'),
    action text NOT NULL CHECK (action IN ('ACCEPT','COUNTER','DECLINE','EXPIRE')),
    executable_price_per_kg numeric,
    reason text NOT NULL,
    policy_version text NOT NULL,
    decided_at timestamptz NOT NULL,
    UNIQUE(negotiation_id, session_revision, intent_digest)
);
INSERT INTO schema_migrations(version) VALUES ('0013_negotiations');
COMMIT;
