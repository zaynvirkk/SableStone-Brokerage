BEGIN;
CREATE TABLE matches (
    id uuid PRIMARY KEY,
    offer_id uuid NOT NULL,
    offer_version integer NOT NULL,
    demand_id uuid NOT NULL,
    demand_version integer NOT NULL,
    compatible boolean NOT NULL,
    rejection_reasons jsonb NOT NULL,
    matcher_version text NOT NULL,
    context_digest text NOT NULL CHECK (context_digest ~ '^[0-9a-f]{64}$'),
    evaluated_at timestamptz NOT NULL,
    UNIQUE(offer_id, offer_version, demand_id, demand_version, matcher_version, context_digest),
    CHECK ((compatible AND rejection_reasons = '[]'::jsonb) OR NOT compatible)
);
INSERT INTO schema_migrations(version) VALUES ('0010_matches');
COMMIT;
