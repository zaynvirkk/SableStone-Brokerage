begin;
create table outreach_policies(
 version text primary key check(length(trim(version))>0),
 authority_receipt_id uuid not null references authority_receipts(receipt_id),
 outreach_approved boolean not null,
 allowed_jurisdictions text[] not null check(cardinality(allowed_jurisdictions)>0),
 allowed_contact_sources text[] not null check(cardinality(allowed_contact_sources)>0 and allowed_contact_sources <@ array['PUBLIC_COMPANY_SITE','HUNTER','APOLLO','INBOUND']::text[]),
 allowed_organization_roles text[] not null check(cardinality(allowed_organization_roles)>0 and allowed_organization_roles <@ array['SUPPLIER','BUYER']::text[]),
 effective_at timestamptz not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 check(expires_at>effective_at)
);
create trigger outreach_policies_no_update_delete before update or delete on outreach_policies for each row execute function reject_domain_event_mutation();
alter table outbound_email_jobs
 add column message_class text not null default 'TRANSACTIONAL' check(message_class in('TRANSACTIONAL','ACQUISITION')),
 add column source_contact_id uuid references contacts(id),
 add column outreach_policy_version text references outreach_policies(version),
 add constraint outbound_email_jobs_acquisition_policy_check check((message_class='ACQUISITION' and source_contact_id is not null and outreach_policy_version is not null) or (message_class='TRANSACTIONAL' and source_contact_id is null and outreach_policy_version is null));
insert into schema_migrations(version) values('0051_outreach_policies');
commit;
