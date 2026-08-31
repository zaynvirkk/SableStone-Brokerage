begin;
create table if not exists protected_relationship_policies(
 id uuid not null, version text not null, protection_months integer not null check(protection_months between 1 and 60), affiliate_scope text not null,
 qualifying_purchase_definition text not null, legal_gate_receipt_id uuid not null references authority_receipts(receipt_id), effective_at timestamptz not null, expires_at timestamptz not null,
 primary key(id,version), check(expires_at>effective_at)
);
create table if not exists protected_match_acceptances(
 id uuid primary key, match_id uuid not null references matches(id), role text not null check(role in('SUPPLIER','BUYER')), organization_id uuid not null references organizations(id),
 agreement_acceptance_id uuid not null references agreement_acceptances(id), acceptance_digest text not null check(acceptance_digest ~ '^[0-9a-f]{64}$'), accepted_at timestamptz not null,
 unique(match_id,role), unique(match_id,organization_id),
 check((role='SUPPLIER') or (role='BUYER'))
);
alter table trades add column if not exists geography text not null default 'DOMESTIC_INDIA' check(geography in('DOMESTIC_INDIA','INTERNATIONAL'));
alter table trades add column if not exists relationship_maturity text not null default 'NEW' check(relationship_maturity in('NEW','ESTABLISHED'));
alter table trades add column if not exists has_documentary_lc boolean not null default false;
alter table trades add column if not exists match_id uuid references matches(id);
create table if not exists settlement_instruction_acceptances(
 id uuid primary key, instruction_id uuid not null references settlement_instructions(id), role text not null check(role in('SUPPLIER','BUYER')), organization_id uuid not null references organizations(id),
 instruction_digest text not null check(instruction_digest ~ '^[0-9a-f]{64}$'), accepted_at timestamptz not null, unique(instruction_id,role), unique(instruction_id,organization_id)
);
create table if not exists production_commands(
 id uuid primary key, command_type text not null check(command_type in('PROTECT_MATCH','CREATE_SETTLEMENT','LOCK_AND_RELEASE','REFRESH_OFFER','CONFIRM_DEMAND')),
 aggregate_id uuid not null, idempotency_key text not null unique, payload jsonb not null, state text not null check(state in('PENDING','PROCESSING','COMPLETED','REJECTED')),
 created_at timestamptz not null default now(), completed_at timestamptz
);
create trigger protected_match_acceptances_no_update_delete before update or delete on protected_match_acceptances for each row execute function reject_domain_event_mutation();
create trigger settlement_instruction_acceptances_no_update_delete before update or delete on settlement_instruction_acceptances for each row execute function reject_domain_event_mutation();
insert into schema_migrations(version) values('0028_production_commands') on conflict do nothing;
commit;
