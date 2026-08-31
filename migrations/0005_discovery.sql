BEGIN;
CREATE TABLE discovery_receipts (
    id uuid PRIMARY KEY,
    source_kind text NOT NULL CHECK (source_kind IN ('CPCB_COMMON_EPR','SPCB_PCC','PUBLIC_WEBSITE','SEARCH','INBOUND')),
    canonical_url text NOT NULL,
    retrieved_at timestamptz NOT NULL,
    body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
    body_object_key text NOT NULL,
    policy_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(canonical_url, body_sha256)
);
CREATE TABLE organization_candidates (
    id uuid PRIMARY KEY,
    discovery_receipt_id uuid NOT NULL REFERENCES discovery_receipts(id),
    legal_name text NOT NULL,
    website text,
    registration_identifier text,
    registration_state text NOT NULL CHECK (registration_state IN ('SOURCE_STATED','UNVERIFIED')),
    discovered_at timestamptz NOT NULL,
    CHECK (registration_identifier IS NOT NULL OR registration_state = 'UNVERIFIED')
);
INSERT INTO schema_migrations(version) VALUES ('0005_discovery');
COMMIT;
