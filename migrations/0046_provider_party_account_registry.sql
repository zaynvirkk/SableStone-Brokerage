begin;

alter table provider_party_accounts
  alter column verification_receipt_id type uuid using verification_receipt_id::uuid,
  add constraint provider_party_accounts_verification_receipt_fk
    foreign key (verification_receipt_id) references authority_receipts(receipt_id);

create unique index provider_party_accounts_external_identity_unique
  on provider_party_accounts(provider, party_role, reference_sha256);

create table provider_party_account_revocations (
  id uuid primary key,
  provider_party_account_id uuid not null unique references provider_party_accounts(id),
  authority_receipt_id uuid not null references authority_receipts(receipt_id),
  reason text not null check (length(trim(reason)) between 8 and 500),
  revoked_at timestamptz not null,
  created_at timestamptz not null default now()
);

create trigger provider_party_accounts_no_update_delete
before update or delete on provider_party_accounts
for each row execute function reject_domain_event_mutation();

create trigger provider_party_account_revocations_no_update_delete
before update or delete on provider_party_account_revocations
for each row execute function reject_domain_event_mutation();

insert into schema_migrations(version) values ('0045_provider_party_accounts') on conflict do nothing;
insert into schema_migrations(version) values ('0046_provider_party_account_registry');
commit;
