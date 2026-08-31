BEGIN;
CREATE TABLE material_contracts (
 id uuid PRIMARY KEY, trade_id uuid NOT NULL UNIQUE, seller_organization_id uuid NOT NULL REFERENCES organizations(id),
 buyer_organization_id uuid NOT NULL REFERENCES organizations(id), broker_organization_id uuid NOT NULL REFERENCES organizations(id),
 material_invoice_issuer_id uuid NOT NULL, quality_obligation_owner_id uuid NOT NULL, title_holder_until_transfer_id uuid NOT NULL,
 agreement_digest text NOT NULL CHECK (agreement_digest ~ '^[0-9a-f]{64}$'), accepted_at timestamptz NOT NULL,
 CHECK (seller_organization_id = material_invoice_issuer_id AND seller_organization_id = quality_obligation_owner_id AND seller_organization_id = title_holder_until_transfer_id),
 CHECK (seller_organization_id <> buyer_organization_id AND broker_organization_id <> seller_organization_id AND broker_organization_id <> buyer_organization_id)
);
CREATE TABLE shipment_events (
 event_id uuid PRIMARY KEY, trade_id uuid NOT NULL, carrier_organization_id uuid NOT NULL, responsible_party_id uuid NOT NULL,
 event_type text NOT NULL CHECK (event_type IN ('DISPATCHED','IN_TRANSIT','DELIVERED')), document_receipt_id uuid NOT NULL, occurred_at timestamptz NOT NULL
);
CREATE TABLE inspection_events (
 id uuid PRIMARY KEY, trade_id uuid NOT NULL, inspection_provider_id uuid NOT NULL, engaged_by_organization_id uuid NOT NULL,
 paid_by_organization_id uuid NOT NULL, certificate_receipt_id uuid NOT NULL, verdict text NOT NULL CHECK (verdict IN ('PASS','FAIL','WAIVED_BY_BUYER')), occurred_at timestamptz NOT NULL
);
CREATE TABLE trade_disputes (
 id uuid PRIMARY KEY, trade_id uuid NOT NULL, external_procedure_owner text NOT NULL, funds_frozen_by_provider boolean NOT NULL CHECK (funds_frozen_by_provider), reason text NOT NULL, opened_at timestamptz NOT NULL
);
INSERT INTO schema_migrations(version) VALUES ('0020_trade_operations'); COMMIT;
