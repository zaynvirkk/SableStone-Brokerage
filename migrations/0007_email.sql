BEGIN;
CREATE TABLE communications (
    id uuid PRIMARY KEY,
    external_event_id text NOT NULL UNIQUE,
    event_type text NOT NULL CHECK (event_type IN ('MESSAGE_RECEIVED','MESSAGE_SENT','BOUNCE')),
    thread_id text NOT NULL,
    message_id text NOT NULL,
    sender_ciphertext bytea NOT NULL,
    recipient_ciphertext bytea NOT NULL,
    occurred_at timestamptz NOT NULL,
    payload_object_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE provider_cursors (
    provider text PRIMARY KEY,
    cursor text NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE TABLE outbound_messages (
    idempotency_key text PRIMARY KEY,
    communication_id uuid REFERENCES communications(id),
    transport_mode text NOT NULL CHECK (transport_mode IN ('SANDBOX','PRODUCTION')),
    status text NOT NULL CHECK (status IN ('QUEUED','SENT','FAILED','SUPPRESSED')),
    created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES ('0007_email');
COMMIT;
