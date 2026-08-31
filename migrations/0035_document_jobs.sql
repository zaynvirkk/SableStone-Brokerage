begin;
create table if not exists document_processing_jobs(
 id uuid primary key,
 communication_id uuid not null unique references communications(id),
 raw_mime_object_key text not null,
 raw_mime_sha256 text not null check(raw_mime_sha256 ~ '^[0-9a-f]{64}$'),
 source_message_id text not null,
 state text not null check(state in('PENDING','PROCESSING','COMPLETED','REJECTED_SECURITY','FAILED')),
 attempts integer not null default 0 check(attempts>=0),
 claimed_at timestamptz,
 completed_at timestamptz,
 last_error_code text,
 created_at timestamptz not null default now()
);
create index if not exists document_processing_jobs_pending on document_processing_jobs(created_at) where state in('PENDING','PROCESSING');
insert into schema_migrations(version) values('0035_document_jobs') on conflict do nothing;
commit;
