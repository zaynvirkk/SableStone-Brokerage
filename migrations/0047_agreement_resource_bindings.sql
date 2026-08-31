begin;

create table agreement_resource_bindings (
  id uuid primary key,
  agreement_id uuid not null,
  agreement_version text not null,
  resource_type text not null check (resource_type in ('ORG_MASTER','MATCH','TRADE')),
  resource_id uuid not null,
  expected_organization_id uuid not null references organizations(id),
  role text not null check (role in ('SUPPLIER','BUYER')),
  binding_sha256 text not null check (binding_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (agreement_id,agreement_version) references agreements(id,version),
  unique(agreement_id,agreement_version,resource_type,resource_id,expected_organization_id,role)
);

alter table agreement_acceptances add column agreement_binding_id uuid references agreement_resource_bindings(id);

do $$
begin
  if exists(select 1 from agreement_acceptances where agreement_binding_id is null) then
    raise exception 'legacy agreement acceptances require receipt-backed resource binding migration';
  end if;
end $$;

alter table agreement_acceptances alter column agreement_binding_id set not null;

create trigger agreement_resource_bindings_no_update_delete
before update or delete on agreement_resource_bindings
for each row execute function reject_domain_event_mutation();

insert into schema_migrations(version) values ('0047_agreement_resource_bindings');
commit;
