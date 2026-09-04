begin;

alter table transactional_outbox drop constraint if exists transactional_outbox_state_check;
update transactional_outbox set state='DEAD_LETTER_PENDING_REDRIVE' where state='FAILED';
alter table transactional_outbox add constraint transactional_outbox_state_check
  check(state in('PENDING','PROCESSING','PUBLISHED','DEAD_LETTER_PENDING_REDRIVE'));
alter table transactional_outbox add column if not exists next_retry_at timestamptz;
update transactional_outbox set next_retry_at=now() where state='DEAD_LETTER_PENDING_REDRIVE' and next_retry_at is null;
alter table transactional_outbox add column if not exists redrive_count integer not null default 0 check(redrive_count>=0);
create index if not exists transactional_outbox_redrive on transactional_outbox(next_retry_at)
  where state='DEAD_LETTER_PENDING_REDRIVE';

alter table outbound_email_jobs drop constraint if exists outbound_email_jobs_state_check;
update outbound_email_jobs set state='DEAD_LETTER_PENDING_REDRIVE' where state='FAILED';
alter table outbound_email_jobs add constraint outbound_email_jobs_state_check
  check(state in('PENDING','PROCESSING','SENT','SUPPRESSED','DEAD_LETTER_PENDING_REDRIVE'));
alter table outbound_email_jobs add column if not exists next_retry_at timestamptz;
update outbound_email_jobs set next_retry_at=now() where state='DEAD_LETTER_PENDING_REDRIVE' and next_retry_at is null;
alter table outbound_email_jobs add column if not exists redrive_count integer not null default 0 check(redrive_count>=0);
create index if not exists outbound_email_jobs_redrive on outbound_email_jobs(next_retry_at)
  where state='DEAD_LETTER_PENDING_REDRIVE';

alter table counterparty_action_notifications drop constraint if exists counterparty_action_notifications_state_check;
update counterparty_action_notifications set state='DEAD_LETTER_PENDING_REDRIVE' where state='FAILED';
alter table counterparty_action_notifications add constraint counterparty_action_notifications_state_check
  check(state in('PENDING','PROCESSING','SENT','DEAD_LETTER_PENDING_REDRIVE'));
alter table counterparty_action_notifications add column if not exists next_retry_at timestamptz;
update counterparty_action_notifications set next_retry_at=now() where state='DEAD_LETTER_PENDING_REDRIVE' and next_retry_at is null;
alter table counterparty_action_notifications add column if not exists redrive_count integer not null default 0 check(redrive_count>=0);

alter table identity_provisioning_jobs drop constraint if exists identity_provisioning_jobs_state_check;
update identity_provisioning_jobs set state='DEAD_LETTER_PENDING_REDRIVE' where state='FAILED';
alter table identity_provisioning_jobs add constraint identity_provisioning_jobs_state_check
  check(state in('PENDING','PROCESSING','INVITED','ACTIVE','DISABLED','DEAD_LETTER_PENDING_REDRIVE'));
alter table identity_provisioning_jobs add column if not exists next_retry_at timestamptz;
update identity_provisioning_jobs set next_retry_at=now() where state='DEAD_LETTER_PENDING_REDRIVE' and next_retry_at is null;
alter table identity_provisioning_jobs add column if not exists redrive_count integer not null default 0 check(redrive_count>=0);

alter table commercial_notification_jobs drop constraint if exists commercial_notification_jobs_state_check;
update commercial_notification_jobs set state='DEAD_LETTER_PENDING_REDRIVE' where state='FAILED';
alter table commercial_notification_jobs add constraint commercial_notification_jobs_state_check check(state in('PENDING','PROCESSING','COMPLETED','SUPPRESSED','DEAD_LETTER_PENDING_REDRIVE'));
alter table commercial_notification_jobs add column if not exists next_retry_at timestamptz;
update commercial_notification_jobs set next_retry_at=now() where state='DEAD_LETTER_PENDING_REDRIVE' and next_retry_at is null;
alter table commercial_notification_jobs add column if not exists redrive_count integer not null default 0 check(redrive_count>=0);

alter table settlement_allocation_links drop constraint if exists settlement_allocation_links_source_kind_check;
alter table settlement_allocation_links add constraint settlement_allocation_links_source_kind_check
  check(source_kind in('PROVIDER_ENTRY','BANK_ENTRY','BANK_ADJUSTMENT'));
alter table settlement_allocation_links drop constraint if exists settlement_allocation_links_source_reference_trade_id_key;
alter table settlement_allocation_links add constraint settlement_allocation_links_trade_source_unique
  unique(source_kind,source_reference,trade_id);
create index if not exists settlement_allocation_links_source on settlement_allocation_links(source_kind,source_reference);

create extension if not exists pgcrypto;
alter table settlement_instructions add column if not exists funding_token_ciphertext bytea;
alter table counterparty_dispute_requests add column if not exists provider_dispute_reference text;
alter table counterparty_dispute_requests add column if not exists provider_evidence_sha256 text check(provider_evidence_sha256 is null or provider_evidence_sha256 ~ '^[0-9a-f]{64}$');

alter table settlement_provider_events drop constraint if exists settlement_provider_events_event_type_check;
alter table settlement_provider_events add constraint settlement_provider_events_event_type_check
  check(event_type in('FUNDED','DISBURSEMENT_REPORTED','FAILED','REVERSED','DISPUTE_OPENED','DISPUTE_RESOLVED_BUYER','DISPUTE_RESOLVED_SUPPLIER','REFUNDED'));

insert into schema_migrations(version) values('0060_final_launch_integrity');
commit;
