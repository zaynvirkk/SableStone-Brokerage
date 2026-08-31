begin;
create table if not exists negotiation_policies(
 id uuid not null,
 version text not null,
 currency char(3) not null,
 maximum_concession_per_kg numeric not null check(maximum_concession_per_kg>=0),
 valid_from timestamptz not null,
 valid_until timestamptz not null,
 authority_receipt_id uuid not null references authority_receipts(receipt_id),
 primary key(id,version),
 check(valid_until>valid_from)
);
create table if not exists commercial_notification_jobs(
 id uuid primary key,
 match_id uuid not null references matches(id),
 negotiation_id uuid not null references negotiations(id),
 recipient_role text not null check(recipient_role in('SUPPLIER','BUYER')),
 state text not null check(state in('PENDING','PROCESSING','COMPLETED','SUPPRESSED','FAILED')),
 attempts integer not null default 0 check(attempts>=0),
 claimed_at timestamptz,
 completed_at timestamptz,
 last_error_code text,
 created_at timestamptz not null default now(),
 unique(negotiation_id,recipient_role)
);
create unique index if not exists negotiations_one_session_per_match on negotiations(match_id);
create index if not exists commercial_notification_jobs_pending on commercial_notification_jobs(created_at) where state in('PENDING','PROCESSING');
insert into schema_migrations(version) values('0041_negotiation_notifications') on conflict do nothing;
commit;
