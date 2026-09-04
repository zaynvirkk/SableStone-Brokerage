begin;

alter table external_event_inbox drop constraint external_event_inbox_processing_state_check;
alter table external_event_inbox
  add constraint external_event_inbox_processing_state_check
  check(processing_state in('PENDING','PROCESSING','PROCESSED','REJECTED','DEAD_LETTER_PENDING_REDRIVE'));
alter table external_event_inbox add column if not exists next_retry_at timestamptz;
alter table external_event_inbox add column if not exists failure_class text;
alter table external_event_inbox add column if not exists redrive_count integer not null default 0 check(redrive_count>=0);
create index external_event_inbox_redrive on external_event_inbox(next_retry_at)
  where processing_state='DEAD_LETTER_PENDING_REDRIVE';

alter table standing_renewal_reservations drop constraint standing_renewal_reservations_state_check;
alter table standing_renewal_reservations
  add constraint standing_renewal_reservations_state_check
  check(state in('RESERVED','COMMITTED','CONSUMED','RELEASED'));
alter table standing_renewal_reservations add column if not exists committed_at timestamptz;
alter table standing_renewal_reservations add column if not exists trade_id uuid references trades(id);
alter table standing_renewal_reservations add column if not exists final_economics_snapshot_id uuid references final_economics_snapshots(id);
drop index standing_renewal_reservations_live_cycle;
create unique index standing_renewal_reservations_live_cycle on standing_renewal_reservations(demand_id,demand_version,cycle_number)
  where state in('RESERVED','COMMITTED','CONSUMED');

create table protected_transaction_terms(
  id uuid primary key,
  relationship_id uuid not null references protected_relationships(id),
  trade_id uuid not null unique references trades(id),
  final_economics_snapshot_id uuid not null references final_economics_snapshots(id),
  commission_rate numeric not null check(commission_rate>0),
  currency char(3) not null,
  supplier_settlement_acceptance_id uuid references settlement_instruction_acceptances(id),
  buyer_settlement_acceptance_id uuid references settlement_instruction_acceptances(id),
  terms_digest text not null check(terms_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table supplier_payout_controls(
  instruction_id uuid primary key references settlement_instructions(id),
  trade_id uuid not null unique references trades(id),
  provider text not null,
  provider_payout_reference text,
  state text not null check(state in('HELD','RELEASE_PENDING','RELEASED','FROZEN','FAILED')),
  hold_evidence_sha256 text not null check(hold_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  release_evidence_sha256 text check(release_evidence_sha256 is null or release_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  held_at timestamptz not null,
  released_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now()
);

create table counterparty_actions(
  id uuid primary key,
  action_type text not null,
  resource_type text not null,
  resource_id uuid not null,
  organization_id uuid not null references organizations(id),
  actor_role text not null check(actor_role in('SUPPLIER','BUYER')),
  state text not null check(state in('REQUIRED','NOTIFIED','COMPLETED','EXPIRED','CANCELLED')),
  deadline timestamptz not null,
  evidence_required boolean not null default false,
  action_token_digest text not null check(action_token_digest ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(action_type,resource_type,resource_id,organization_id)
);
create index counterparty_actions_due on counterparty_actions(deadline) where state in('REQUIRED','NOTIFIED');
create table counterparty_action_notifications(
  action_id uuid primary key references counterparty_actions(id),
  state text not null check(state in('PENDING','PROCESSING','SENT','FAILED')),
  attempts integer not null default 0,
  reminder_count integer not null default 0,
  next_notification_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error_code text
);

create table counterparty_principals(
  principal_id uuid primary key,
  organization_id uuid not null references organizations(id),
  contact_id uuid references contacts(id),
  role text not null check(role in('SUPPLIER','BUYER')),
  issuer_subject text not null unique,
  state text not null check(state in('INVITED','ACTIVE','DISABLED','REVOKED')),
  invited_at timestamptz not null,
  activated_at timestamptz,
  disabled_at timestamptz
);
create table identity_provisioning_jobs(
  id uuid primary key,
  contact_id uuid not null unique references contacts(id),
  organization_id uuid not null references organizations(id),
  role text not null check(role in('SUPPLIER','BUYER')),
  state text not null check(state in('PENDING','PROCESSING','INVITED','ACTIVE','DISABLED','FAILED')),
  attempts integer not null default 0,
  provider_reference text,
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now()
);

create table counterparty_dispute_requests(
  id uuid primary key,
  trade_id uuid not null unique references trades(id),
  buyer_id uuid not null references organizations(id),
  reason text not null,
  evidence_receipt_id uuid references documents(id),
  state text not null check(state in('OPENED','PROVIDER_SUBMITTED','FROZEN','RESOLVED','REJECTED')),
  opened_at timestamptz not null
);

create table settlement_allocation_links(
  id uuid primary key,
  trade_id uuid not null references trades(id),
  source_kind text not null check(source_kind in('PROVIDER_ENTRY','BANK_ENTRY')),
  source_reference text not null,
  amount numeric not null check(amount>0),
  currency char(3) not null,
  linked_at timestamptz not null default now(),
  unique(source_kind,source_reference,trade_id)
);

insert into schema_migrations(version) values('0059_launch_hardening');
commit;
