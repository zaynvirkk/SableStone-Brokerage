begin;
create table if not exists activation_receipt_bindings(
 receipt_id uuid not null references authority_receipts(receipt_id),
 purpose text not null check(purpose in('OPERATOR_AUTHORIZATION','ENTITY','LEGAL','TAX','PRIVACY','DEPLOYMENT')),
 release_digest text not null check(release_digest ~ '^[0-9a-f]{64}$'),
 bound_at timestamptz not null,
 valid_until timestamptz not null,
 primary key(receipt_id,purpose,release_digest),
 check(valid_until>bound_at)
);
create trigger activation_receipt_bindings_no_update_delete before update or delete on activation_receipt_bindings for each row execute function reject_domain_event_mutation();
insert into schema_migrations(version) values('0042_activation_receipt_bindings') on conflict do nothing;
commit;
