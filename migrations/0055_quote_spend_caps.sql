begin;
create table economic_quote_spend_reservations(
 id uuid primary key,
 job_id uuid not null unique references economic_quote_jobs(id),
 provider text not null,
 billing_date date not null,
 amount numeric not null check(amount>0),
 currency char(3) not null,
 created_at timestamptz not null default now()
);
create index economic_quote_spend_daily on economic_quote_spend_reservations(provider,billing_date,currency);
create table match_candidate_sweeps(
 id uuid primary key,
 anchor_type text not null check(anchor_type in('OFFER','DEMAND')),
 anchor_id uuid not null,
 anchor_version integer not null,
 cursor_created_at timestamptz,
 cursor_id uuid,
 state text not null check(state in('PENDING','PROCESSING','COMPLETED')),
 processed_count bigint not null default 0 check(processed_count>=0),
 claimed_at timestamptz,
 completed_at timestamptz,
 unique(anchor_type,anchor_id,anchor_version)
);
create index match_candidate_sweeps_pending on match_candidate_sweeps(state,claimed_at);
insert into schema_migrations(version) values('0055_quote_spend_caps');
commit;
