BEGIN;

CREATE TABLE schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE durable_inbox (
    provider text NOT NULL,
    external_event_id text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    processed_at timestamptz,
    PRIMARY KEY (provider, external_event_id)
);

CREATE TABLE transactional_outbox (
    event_id uuid PRIMARY KEY,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);

INSERT INTO schema_migrations(version) VALUES ('0001_platform');
COMMIT;
