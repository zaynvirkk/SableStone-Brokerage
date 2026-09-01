begin;
alter table outbound_email_jobs drop constraint if exists outbound_email_jobs_acquisition_policy_check;
alter table outbound_email_jobs drop column if exists outreach_policy_version;
alter table outbound_email_jobs drop column if exists source_contact_id;
alter table outbound_email_jobs drop column if exists message_class;
drop trigger if exists outreach_policies_no_update_delete on outreach_policies;
drop table if exists outreach_policies;
delete from schema_migrations where version='0051_outreach_policies';
commit;
