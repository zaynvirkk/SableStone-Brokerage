begin;
create table carrier_profiles(
  organization_id uuid primary key references organizations(id),
  state text not null check(state in('VERIFIED','DISABLED')),
  authority_receipt_id uuid not null references authority_receipts(receipt_id),
  valid_until timestamptz not null,
  created_at timestamptz not null default now()
);
insert into schema_migrations(version) values('0061_carrier_evidence_execution');
commit;
