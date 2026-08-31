BEGIN;
CREATE TABLE domain_events (
    event_id uuid PRIMARY KEY,
    idempotency_key text NOT NULL UNIQUE,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    event_time timestamptz NOT NULL,
    recorded_time timestamptz NOT NULL DEFAULT now(),
    policy_version text NOT NULL,
    payload jsonb NOT NULL,
    previous_event_id uuid REFERENCES domain_events(event_id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trade_state (
    trade_id uuid PRIMARY KEY,
    current_state text NOT NULL CHECK (current_state IN (
      'MATCHED','NEGOTIATING','PROTECTED','FEE_LOCKED','IDENTITY_RELEASED',
      'CONTRACTED','FUNDED','DISPATCHED','IN_TRANSIT','DELIVERED','ACCEPTED',
      'SETTLED','RECURRING','REJECTED','EXPIRED','CANCELLED','DISPUTED_FROZEN',
      'SETTLEMENT_FAILED'
    )),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    last_event_id uuid NOT NULL REFERENCES domain_events(event_id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reject_domain_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'domain events are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER domain_events_no_update_delete
BEFORE UPDATE OR DELETE ON domain_events
FOR EACH ROW EXECUTE FUNCTION reject_domain_event_mutation();

INSERT INTO schema_migrations(version) VALUES ('0003_lifecycle');
COMMIT;
