begin;
create table if not exists organization_identity_keys(identity_hash text primary key check(identity_hash ~ '^[0-9a-f]{64}$'),organization_id uuid not null references organizations(id),candidate_id uuid not null references organization_candidates(id),created_at timestamptz not null default now());
create table if not exists candidate_organizations(candidate_id uuid primary key references organization_candidates(id),organization_id uuid not null references organizations(id),role text not null check(role in('SUPPLIER','BUYER')),linked_at timestamptz not null default now());
create table if not exists enrichment_jobs(id uuid primary key,candidate_id uuid not null unique references organization_candidates(id),organization_id uuid not null references organizations(id),domain text not null,state text not null check(state in('PENDING','PROCESSING','COMPLETED','FAILED','UNAVAILABLE')),attempts integer not null default 0 check(attempts>=0),claimed_at timestamptz,completed_at timestamptz,last_error_code text,created_at timestamptz not null default now());
create index if not exists enrichment_jobs_pending on enrichment_jobs(created_at) where state in('PENDING','PROCESSING');
create table if not exists communication_organizations(communication_id uuid primary key references communications(id),organization_id uuid not null references organizations(id),contact_id uuid not null references contacts(id),linked_at timestamptz not null default now());
insert into schema_migrations(version) values('0036_candidate_enrichment') on conflict do nothing;
commit;
