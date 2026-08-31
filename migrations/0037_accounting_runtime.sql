begin;
alter table settlement_provider_events add column if not exists bank_reference text;
create table if not exists brokerage_tax_policies(
 id uuid primary key,
 version text not null unique,
 currency char(3) not null,
 tax_rate numeric not null check(tax_rate>=0 and tax_rate<=1),
 tax_inclusive boolean not null,
 authority_receipt_id uuid not null references authority_receipts(receipt_id),
 effective_at timestamptz not null,
 expires_at timestamptz not null,
 check(expires_at>effective_at)
);
create table if not exists bank_receipt_events(
 id uuid primary key,
 provider text not null,
 external_event_id text not null,
 bank_reference text not null unique,
 beneficiary_organization_id uuid not null references organizations(id),
 amount numeric not null check(amount>0),
 currency char(3) not null,
 value_at timestamptz not null,
 payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
 payload_object_key text not null,
 created_at timestamptz not null default now(),
 unique(provider,external_event_id)
);
create trigger brokerage_tax_policies_no_update_delete before update or delete on brokerage_tax_policies for each row execute function reject_domain_event_mutation();
create trigger bank_receipt_events_no_update_delete before update or delete on bank_receipt_events for each row execute function reject_domain_event_mutation();
insert into schema_migrations(version) values('0037_accounting_runtime') on conflict do nothing;
commit;
