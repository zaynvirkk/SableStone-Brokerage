begin;
create table production_credential_bindings(
 id uuid primary key,
 provider text not null,
 capability text not null,
 environment text not null check(environment in('SANDBOX','PRODUCTION')),
 credential_fingerprint text not null check(credential_fingerprint ~ '^[0-9a-f]{64}$'),
 verification_receipt_id uuid not null references authority_receipts(receipt_id),
 verified_at timestamptz not null,
 valid_until timestamptz not null,
 created_at timestamptz not null default now(),
 check(valid_until>verified_at),
 unique(provider,capability,environment,credential_fingerprint)
);
create table production_credential_revocations(
 id uuid primary key,
 credential_binding_id uuid not null unique references production_credential_bindings(id),
 revocation_receipt_id uuid not null references authority_receipts(receipt_id),
 reason text not null check(length(trim(reason))>0),
 revoked_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index production_credential_bindings_current_idx on production_credential_bindings(provider,capability,environment,valid_until);
create trigger production_credential_bindings_no_update_delete before update or delete on production_credential_bindings for each row execute function reject_domain_event_mutation();
create trigger production_credential_revocations_no_update_delete before update or delete on production_credential_revocations for each row execute function reject_domain_event_mutation();
insert into schema_migrations(version) values('0050_production_credentials');
commit;
