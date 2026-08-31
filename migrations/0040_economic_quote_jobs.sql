begin;
create table if not exists economic_quote_jobs(
 id uuid primary key,
 match_id uuid not null references matches(id),
 cost_kind text not null check(cost_kind in('FREIGHT','INSPECTION','PAYMENT_RAIL','TAX_CHARGE','RISK_RESERVE')),
 state text not null check(state in('PENDING','PROCESSING','COMPLETED','REJECTED','FAILED')),
 attempts integer not null default 0 check(attempts>=0),
 claimed_at timestamptz,
 completed_at timestamptz,
 last_error_code text,
 created_at timestamptz not null default now(),
 unique(match_id,cost_kind)
);
create index if not exists economic_quote_jobs_pending on economic_quote_jobs(created_at) where state in('PENDING','PROCESSING');
create table if not exists economic_quote_receipts(
 id uuid primary key,
 provider text not null,
 external_reference text not null,
 cost_kind text not null,
 request_object_key text not null,
 response_object_key text not null,
 response_sha256 text not null check(response_sha256 ~ '^[0-9a-f]{64}$'),
 quoted_at timestamptz not null,
 unique(provider,external_reference,cost_kind)
);
insert into schema_migrations(version) values('0040_economic_quote_jobs') on conflict do nothing;
commit;
