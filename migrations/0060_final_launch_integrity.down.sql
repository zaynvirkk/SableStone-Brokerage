begin;
delete from schema_migrations where version='0060_final_launch_integrity';
drop index if exists settlement_allocation_links_source;
alter table identity_provisioning_jobs drop column if exists redrive_count, drop column if exists next_retry_at;
alter table counterparty_action_notifications drop column if exists redrive_count, drop column if exists next_retry_at;
alter table outbound_email_jobs drop column if exists redrive_count, drop column if exists next_retry_at;
alter table transactional_outbox drop column if exists redrive_count, drop column if exists next_retry_at;
commit;
