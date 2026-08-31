begin;
do $$ begin
 if exists(select 1 from settlement_provider_events where processed_at is not null or payload_digest is not null) then
  raise exception 'legacy settlement provider events require receipt-backed migration before entitlement-security upgrade';
 end if;
end $$;
alter table settlement_provider_events
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists trade_id uuid references trades(id),
  add column if not exists amount numeric,
  add column if not exists currency char(3),
  add column if not exists payload_sha256 text,
  add column if not exists payload_object_key text,
  add column if not exists created_at timestamptz default now();
alter table settlement_provider_events alter column id set not null;
alter table settlement_provider_events alter column trade_id set not null;
alter table settlement_provider_events alter column payload_sha256 set not null;
alter table settlement_provider_events alter column payload_object_key set not null;
alter table settlement_provider_events alter column created_at set not null;
alter table settlement_provider_events add constraint settlement_provider_events_id_unique unique(id);
alter table settlement_provider_events add constraint settlement_provider_events_payload_sha256_check check(payload_sha256 ~ '^[0-9a-f]{64}$');
alter table settlement_instructions
  add column if not exists provider_approval_id uuid references provider_approvals(id),
  add column if not exists entitlement_secured_at timestamptz,
  add column if not exists entitlement_security_event_id uuid;
alter table settlement_provider_events drop constraint if exists settlement_provider_events_event_type_check;
alter table settlement_provider_events add constraint settlement_provider_events_event_type_check
  check(event_type in('ENTITLEMENT_SECURED','FUNDED','DISBURSEMENT_REPORTED','FAILED','REVERSED','DISPUTE_OPENED'));
create table if not exists entitlement_security_events(
 id uuid primary key,
 instruction_id uuid not null unique references settlement_instructions(id),
 settlement_provider_event_id uuid not null unique references settlement_provider_events(id),
 provider text not null,
 provider_reference text not null,
 gross_amount numeric not null check(gross_amount>0),
 supplier_entitlement numeric not null check(supplier_entitlement>0),
 sablestone_entitlement numeric not null check(sablestone_entitlement>0),
 currency char(3) not null,
 beneficiary_verified boolean not null check(beneficiary_verified),
 funds_secured boolean not null check(funds_secured),
 evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 secured_at timestamptz not null
);
create trigger entitlement_security_events_no_update_delete before update or delete on entitlement_security_events for each row execute function reject_domain_event_mutation();
alter table settlement_instructions drop constraint if exists settlement_instructions_entitlement_security_event_fk;
alter table settlement_instructions add constraint settlement_instructions_entitlement_security_event_fk foreign key(entitlement_security_event_id) references entitlement_security_events(id);
insert into schema_migrations(version) values('0043_entitlement_security') on conflict do nothing;
commit;
