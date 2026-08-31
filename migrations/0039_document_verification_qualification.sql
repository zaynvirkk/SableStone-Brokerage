begin;

create table if not exists document_verification_jobs(
 id uuid primary key,
 document_id uuid not null unique references documents(id),
 object_key text not null,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 extraction jsonb not null,
 state text not null check(state in('PENDING','PROCESSING','VERIFIED','REJECTED','FAILED','UNAVAILABLE')),
 attempts integer not null default 0 check(attempts>=0),
 claimed_at timestamptz,
 completed_at timestamptz,
 last_error_code text,
 created_at timestamptz not null default now()
);
create index if not exists document_verification_jobs_pending on document_verification_jobs(created_at) where state in('PENDING','PROCESSING');

create table if not exists document_verification_receipts(
 id uuid primary key,
 document_id uuid not null references documents(id),
 provider text not null,
 external_reference text not null,
 request_object_key text not null,
 response_object_key text not null,
 response_sha256 text not null check(response_sha256 ~ '^[0-9a-f]{64}$'),
 verified_at timestamptz not null,
 unique(provider,external_reference)
);

insert into schema_migrations(version) values('0039_document_verification_qualification') on conflict do nothing;
commit;
