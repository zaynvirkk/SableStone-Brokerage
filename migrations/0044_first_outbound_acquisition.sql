begin;
create table if not exists acquisition_profiles(
 organization_id uuid primary key references organizations(id),
 target_product_family text not null,
 application text not null,
 source_receipt_id uuid not null references discovery_receipts(id),
 classification_state text not null check(classification_state in('SOURCE_STATED','VERIFIED')),
 valid_until timestamptz not null,
 created_at timestamptz not null default now()
);
create table if not exists acquisition_outreach_jobs(
 id uuid primary key,
 organization_id uuid not null unique references organizations(id),
 state text not null check(state in('PENDING','PROCESSING','COMPLETED','SUPPRESSED','FAILED')),
 attempts integer not null default 0 check(attempts>=0),
 claimed_at timestamptz,
 completed_at timestamptz,
 last_error_code text,
 created_at timestamptz not null default now()
);
create index if not exists acquisition_outreach_jobs_pending on acquisition_outreach_jobs(created_at) where state in('PENDING','PROCESSING');
insert into schema_migrations(version) values('0044_first_outbound_acquisition') on conflict do nothing;
commit;
