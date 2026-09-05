begin;

-- A transient outage must never turn a valid business obligation into an
-- unreachable terminal row.  Preserve the old FAILED rows as explicit,
-- automatically redrivable dead letters and give every critical worker a
-- durable retry schedule.
do $$
declare
  table_name text;
  constraint_name text;
begin
  foreach table_name in array array[
    'enrichment_jobs','kyb_jobs','document_processing_jobs',
    'document_verification_jobs','economic_quote_jobs',
    'acquisition_outreach_jobs','commercial_notification_jobs',
    'negotiation_notification_jobs'
  ] loop
    if to_regclass(table_name) is null then continue; end if;
    constraint_name := table_name || '_state_check';
    execute format('alter table %I drop constraint if exists %I', table_name, constraint_name);
    execute format('update %I set state=''DEAD_LETTER_PENDING_REDRIVE'' where state=''FAILED''', table_name);
    execute format('alter table %I add constraint %I check (state <> ''DEAD_LETTER_PENDING_REDRIVE'' or state is not null)', table_name, constraint_name || '_redrive');
    execute format('alter table %I add column if not exists next_retry_at timestamptz', table_name);
    execute format('alter table %I add column if not exists redrive_count integer not null default 0 check(redrive_count>=0)', table_name);
    execute format('update %I set next_retry_at=now() where state=''DEAD_LETTER_PENDING_REDRIVE'' and next_retry_at is null', table_name);
    execute format('create index if not exists %I on %I(next_retry_at) where state=''DEAD_LETTER_PENDING_REDRIVE''', table_name || '_redrive', table_name);
  end loop;
end $$;

-- Reinstall complete checks for tables whose historical checks were known.
alter table enrichment_jobs add constraint enrichment_jobs_state_check_final check(state in('PENDING','PROCESSING','COMPLETED','UNAVAILABLE','DEAD_LETTER_PENDING_REDRIVE'));
alter table kyb_jobs add constraint kyb_jobs_state_check_final check(state in('PENDING','PROCESSING','COMPLETED','UNAVAILABLE','REJECTED','DEAD_LETTER_PENDING_REDRIVE'));
alter table document_processing_jobs add constraint document_processing_jobs_state_check_final check(state in('PENDING','PROCESSING','COMPLETED','REJECTED_SECURITY','DEAD_LETTER_PENDING_REDRIVE'));
alter table document_verification_jobs add constraint document_verification_jobs_state_check_final check(state in('PENDING','PROCESSING','VERIFIED','REJECTED','UNAVAILABLE','DEAD_LETTER_PENDING_REDRIVE'));
alter table economic_quote_jobs add constraint economic_quote_jobs_state_check_final check(state in('PENDING','PROCESSING','COMPLETED','REJECTED','DEAD_LETTER_PENDING_REDRIVE'));
alter table acquisition_outreach_jobs add constraint acquisition_outreach_jobs_state_check_final check(state in('WAITING_CONTACT','WAITING_RISK','WAITING_PROFILE','WAITING_INVENTORY','READY','PROCESSING','COMPLETED','SUPPRESSED','DEAD_LETTER_PENDING_REDRIVE'));
alter table commercial_notification_jobs add constraint commercial_notification_jobs_state_check_final check(state in('PENDING','PROCESSING','COMPLETED','SUPPRESSED','DEAD_LETTER_PENDING_REDRIVE'));

insert into schema_migrations(version) values('0064_durable_job_redrive');
commit;
