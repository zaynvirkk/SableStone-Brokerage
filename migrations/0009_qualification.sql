BEGIN;
CREATE TABLE document_checks (
    id uuid PRIMARY KEY,
    document_id uuid NOT NULL REFERENCES documents(id),
    check_type text NOT NULL,
    state text NOT NULL CHECK (state IN ('VERIFIED','UNVERIFIED','EXPIRED','MISMATCH')),
    source_receipt_id uuid,
    valid_until timestamptz,
    checked_at timestamptz NOT NULL,
    checker_version text NOT NULL,
    UNIQUE(document_id, check_type, checker_version)
);
CREATE TABLE qualification_decisions (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id),
    subject_type text NOT NULL CHECK (subject_type IN ('SUPPLIER_OFFER','BUYER_DEMAND')),
    subject_id uuid NOT NULL,
    subject_version integer NOT NULL CHECK (subject_version > 0),
    verdict text NOT NULL CHECK (verdict IN ('PASS','FAIL','REQUEST_DOCUMENTS')),
    reasons jsonb NOT NULL,
    policy_version text NOT NULL,
    decided_at timestamptz NOT NULL,
    UNIQUE(subject_type, subject_id, subject_version, policy_version)
);
CREATE TABLE inventory_refreshes (
    id uuid PRIMARY KEY,
    offer_id uuid NOT NULL,
    offer_version integer NOT NULL,
    action text NOT NULL CHECK (action IN ('SAME','UPDATE_PRICE','UPDATE_STOCK','SOLD_OUT')),
    confirmed_at timestamptz NOT NULL,
    payload jsonb NOT NULL,
    source_event_id uuid NOT NULL UNIQUE,
    UNIQUE(offer_id, offer_version, source_event_id)
);
INSERT INTO schema_migrations(version) VALUES ('0009_qualification');
COMMIT;
