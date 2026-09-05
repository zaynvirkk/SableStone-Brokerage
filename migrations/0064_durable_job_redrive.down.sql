begin;
-- Downgrade is intentionally conservative: do not turn recoverable work back
-- into terminal FAILED rows.  Remove only the indexes/columns introduced by
-- this migration after the operator has drained the redrive queues.
drop index if exists enrichment_jobs_redrive;
drop index if exists kyb_jobs_redrive;
drop index if exists document_processing_jobs_redrive;
drop index if exists document_verification_jobs_redrive;
drop index if exists economic_quote_jobs_redrive;
drop index if exists acquisition_outreach_jobs_redrive;
drop index if exists commercial_notification_jobs_redrive;
alter table enrichment_jobs drop constraint if exists enrichment_jobs_state_check_final;
alter table kyb_jobs drop constraint if exists kyb_jobs_state_check_final;
alter table document_processing_jobs drop constraint if exists document_processing_jobs_state_check_final;
alter table document_verification_jobs drop constraint if exists document_verification_jobs_state_check_final;
alter table economic_quote_jobs drop constraint if exists economic_quote_jobs_state_check_final;
alter table acquisition_outreach_jobs drop constraint if exists acquisition_outreach_jobs_state_check_final;
alter table commercial_notification_jobs drop constraint if exists commercial_notification_jobs_state_check_final;
delete from schema_migrations where version='0064_durable_job_redrive';
commit;
