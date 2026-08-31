BEGIN;
CREATE TABLE extraction_proposals (
    id uuid PRIMARY KEY,
    communication_id uuid NOT NULL REFERENCES communications(id),
    source_body_sha256 text NOT NULL CHECK (source_body_sha256 ~ '^[0-9a-f]{64}$'),
    extractor_version text NOT NULL,
    status text NOT NULL CHECK (status IN ('PROPOSED','REJECTED_SECURITY','REJECTED_SCHEMA')),
    proposed_payload jsonb,
    reasons jsonb NOT NULL,
    verified boolean NOT NULL DEFAULT false CHECK (verified = false),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(communication_id, extractor_version, source_body_sha256),
    CHECK ((status = 'PROPOSED' AND proposed_payload IS NOT NULL) OR status <> 'PROPOSED')
);
CREATE TABLE attachment_checks (
    id uuid PRIMARY KEY,
    communication_id uuid NOT NULL REFERENCES communications(id),
    object_key text NOT NULL,
    media_type text NOT NULL,
    compressed_bytes bigint NOT NULL CHECK (compressed_bytes >= 0),
    expanded_bytes bigint NOT NULL CHECK (expanded_bytes >= 0),
    member_count integer NOT NULL CHECK (member_count > 0),
    malware_state text NOT NULL CHECK (malware_state IN ('CLEAN','INFECTED','UNAVAILABLE')),
    accepted boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES ('0008_extraction');
COMMIT;
