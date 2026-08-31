begin;
create table if not exists external_evidence_receipts(id uuid primary key,provider text not null,object_key text not null unique,sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),recorded_at timestamptz not null default now());
create table if not exists kyb_jobs(id uuid primary key,organization_id uuid not null unique references organizations(id),candidate_id uuid not null references organization_candidates(id),country_code char(2) not null,state text not null check(state in('PENDING','PROCESSING','COMPLETED','FAILED','UNAVAILABLE','REJECTED')),attempts integer not null default 0 check(attempts>=0),claimed_at timestamptz,completed_at timestamptz,last_error_code text,created_at timestamptz not null default now());
create index if not exists kyb_jobs_pending on kyb_jobs(created_at) where state in('PENDING','PROCESSING');
create table if not exists risk_policies(id uuid primary key,version text not null unique,required_checks jsonb not null,accepted_providers jsonb not null,authority_receipt_id uuid not null references authority_receipts(receipt_id),effective_at timestamptz not null,expires_at timestamptz not null,check(expires_at>effective_at));
create trigger external_evidence_receipts_no_update_delete before update or delete on external_evidence_receipts for each row execute function reject_domain_event_mutation();
create trigger risk_policies_no_update_delete before update or delete on risk_policies for each row execute function reject_domain_event_mutation();
insert into schema_migrations(version) values('0038_kyb_jobs') on conflict do nothing;
commit;
