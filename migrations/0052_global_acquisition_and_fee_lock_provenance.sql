begin;

alter table acquisition_profiles drop constraint if exists acquisition_profiles_pkey;
alter table acquisition_profiles add column if not exists id uuid default gen_random_uuid();
alter table acquisition_profiles alter column id set not null;
alter table acquisition_profiles add constraint acquisition_profiles_pkey primary key(id);
alter table acquisition_profiles add constraint acquisition_profiles_lane_unique
  unique(organization_id,target_product_family,application);

alter table acquisition_outreach_jobs drop constraint if exists acquisition_outreach_jobs_state_check;
alter table acquisition_outreach_jobs drop constraint if exists acquisition_outreach_jobs_organization_id_key;
alter table acquisition_outreach_jobs add column if not exists acquisition_profile_id uuid references acquisition_profiles(id);
update acquisition_outreach_jobs set state='READY' where state='PENDING';
alter table acquisition_outreach_jobs add constraint acquisition_outreach_jobs_state_check
  check(state in('WAITING_CONTACT','WAITING_RISK','WAITING_PROFILE','WAITING_INVENTORY','READY','PROCESSING','COMPLETED','SUPPRESSED','FAILED'));
drop index if exists acquisition_outreach_jobs_pending;
create index acquisition_outreach_jobs_ready on acquisition_outreach_jobs(created_at)
  where state in('WAITING_CONTACT','WAITING_RISK','WAITING_PROFILE','WAITING_INVENTORY','READY','PROCESSING');
create unique index acquisition_outreach_jobs_profile_unique on acquisition_outreach_jobs(organization_id,acquisition_profile_id)
  where acquisition_profile_id is not null;
create unique index acquisition_outreach_jobs_unprofiled_unique on acquisition_outreach_jobs(organization_id)
  where acquisition_profile_id is null;

create table organization_jurisdictions(
 organization_id uuid primary key references organizations(id),
 country_code char(2) not null check(country_code ~ '^[A-Z]{2}$'),
 source_receipt_id uuid not null references discovery_receipts(id),
 verified_risk_check_id uuid references risk_checks(id),
 state text not null check(state in('SOURCE_STATED','VERIFIED')),
 valid_until timestamptz not null,
 created_at timestamptz not null default now(),
 check(state='SOURCE_STATED' or verified_risk_check_id is not null)
);

alter table discovery_source_configs add column if not exists country_code char(2)
  check(country_code is null or country_code ~ '^[A-Z]{2}$');

create table documentary_lc_route_evidence(
 relationship_id uuid primary key references protected_relationships(id),
 document_id uuid not null unique references documents(id),
 document_check_id uuid not null unique references document_checks(id),
 valid_until timestamptz not null,
 created_at timestamptz not null default now()
);

alter table documents add column if not exists source_communication_id uuid references communications(id);

alter table fee_locks add column if not exists entitlement_security_event_id uuid;
update fee_locks f set entitlement_security_event_id=e.id
from entitlement_security_events e where e.instruction_id=f.instruction_id;
do $$ begin
 if exists(select 1 from fee_locks where entitlement_security_event_id is null) then
  raise exception 'fee lock lacks entitlement-security provenance';
 end if;
end $$;
alter table fee_locks alter column entitlement_security_event_id set not null;
alter table fee_locks add constraint fee_locks_entitlement_security_event_fk
 foreign key(entitlement_security_event_id) references entitlement_security_events(id);
alter table fee_locks add constraint fee_locks_entitlement_security_event_unique
 unique(entitlement_security_event_id);

insert into schema_migrations(version) values('0052_global_acquisition_and_fee_lock_provenance');
commit;
