begin;
create table if not exists discovery_source_configs(
 id uuid primary key,
 role text not null check(role in('SUPPLIER','BUYER')),
 source_kind text not null check(source_kind in('CPCB_COMMON_EPR','SPCB_PCC','PUBLIC_WEBSITE','SEARCH','INBOUND')),
 seed_url text not null check(seed_url ~ '^https://'),
 allowed_hosts jsonb not null,
 maximum_pages integer not null check(maximum_pages between 1 and 100),
 parser_config jsonb not null,
 source_policy_receipt_id uuid not null references authority_receipts(receipt_id),
 state text not null check(state in('APPROVED','UNDER_REVIEW','REVOKED')),
 valid_from timestamptz not null,
 valid_until timestamptz not null,
 created_at timestamptz not null default now(),
 check(valid_until>valid_from)
);
create table if not exists workflow_schedules(
 id uuid primary key,
 schedule_kind text not null check(schedule_kind in('DISCOVER_SUPPLIER','DISCOVER_BUYER')),
 source_id uuid not null unique references discovery_source_configs(id),
 interval_seconds integer not null check(interval_seconds between 3600 and 2592000),
 next_run_at timestamptz not null,
 state text not null check(state in('ACTIVE','PAUSED','REVOKED')),
 last_started_at timestamptz,
 last_workflow_id text
);
create trigger discovery_source_configs_no_update_delete before update or delete on discovery_source_configs for each row execute function reject_domain_event_mutation();
insert into schema_migrations(version) values('0033_discovery_scheduling') on conflict do nothing;
commit;
