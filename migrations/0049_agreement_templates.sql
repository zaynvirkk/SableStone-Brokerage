begin;
create table agreement_templates (
  id uuid primary key,
  agreement_kind text not null,
  version text not null,
  resource_type text not null check(resource_type in('ORG_MASTER','MATCH','TRADE')),
  role text not null check(role in('SUPPLIER','BUYER')),
  template_object_key text not null,
  template_sha256 text not null check(template_sha256 ~ '^[0-9a-f]{64}$'),
  placeholder_names jsonb not null,
  legal_gate_receipt_id uuid not null references authority_receipts(receipt_id),
  effective_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(agreement_kind,version,role),
  check(expires_at>effective_at)
);
create trigger agreement_templates_no_update_delete before update or delete on agreement_templates for each row execute function reject_domain_event_mutation();
alter table agreement_resource_bindings add column agreement_kind text;
update agreement_resource_bindings b set agreement_kind=a.agreement_kind from agreements a where a.id=b.agreement_id and a.version=b.agreement_version;
alter table agreement_resource_bindings alter column agreement_kind set not null;
create unique index agreement_resource_binding_semantic_unique on agreement_resource_bindings(agreement_kind,agreement_version,resource_type,resource_id,expected_organization_id,role);
insert into schema_migrations(version) values('0049_agreement_templates');
commit;
