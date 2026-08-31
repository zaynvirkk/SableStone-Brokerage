BEGIN;

CREATE TYPE evidence_state AS ENUM ('KNOWN', 'UNKNOWN');
CREATE TYPE verification_state AS ENUM ('DRAFT', 'VERIFIED', 'REJECTED');
CREATE TYPE freshness_state AS ENUM ('CURRENT', 'STALE', 'EXPIRED');

CREATE TABLE organizations (
    id uuid PRIMARY KEY,
    organization_type text NOT NULL CHECK (organization_type IN ('SUPPLIER', 'BUYER', 'SABLESTONE', 'PROVIDER')),
    legal_name_ciphertext bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id),
    kind text NOT NULL,
    object_key_ciphertext bytea NOT NULL,
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE registrations (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id),
    jurisdiction text NOT NULL,
    registration_type text NOT NULL,
    identifier_ciphertext bytea NOT NULL,
    state evidence_state NOT NULL,
    source_document_id uuid REFERENCES documents(id),
    valid_until timestamptz,
    CHECK ((state = 'KNOWN' AND source_document_id IS NOT NULL) OR state = 'UNKNOWN')
);

CREATE TABLE supplier_offers (
    id uuid NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    supplier_id uuid NOT NULL REFERENCES organizations(id),
    source_event_id uuid NOT NULL,
    supersedes_offer_id uuid,
    product_family text NOT NULL,
    product_spec jsonb NOT NULL,
    quantity_mt numeric NOT NULL CHECK (quantity_mt >= 0),
    moq_mt numeric NOT NULL CHECK (moq_mt >= 0),
    supplier_net numeric NOT NULL CHECK (supplier_net >= 0),
    currency char(3) NOT NULL,
    expires_at timestamptz NOT NULL,
    verification verification_state NOT NULL,
    freshness freshness_state NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, version)
);

CREATE TABLE buyer_demands (
    id uuid NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    buyer_id uuid NOT NULL REFERENCES organizations(id),
    source_event_id uuid NOT NULL,
    product_family text NOT NULL,
    product_spec jsonb NOT NULL,
    quantity_mt numeric NOT NULL CHECK (quantity_mt >= 0),
    buyer_ceiling numeric CHECK (buyer_ceiling >= 0),
    ceiling_state evidence_state NOT NULL,
    currency char(3),
    standing boolean NOT NULL DEFAULT false,
    expires_at timestamptz NOT NULL,
    verification verification_state NOT NULL,
    freshness freshness_state NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((ceiling_state = 'KNOWN' AND buyer_ceiling IS NOT NULL AND currency IS NOT NULL)
        OR (ceiling_state = 'UNKNOWN' AND buyer_ceiling IS NULL)),
    PRIMARY KEY (id, version)
);

INSERT INTO schema_migrations(version) VALUES ('0002_domain');
COMMIT;
