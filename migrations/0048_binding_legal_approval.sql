begin;
alter table agreement_resource_bindings add column legal_gate_receipt_id uuid references authority_receipts(receipt_id);
do $$ begin
  if exists(select 1 from agreement_resource_bindings where legal_gate_receipt_id is null) then
    raise exception 'legacy agreement bindings require exact receipt-backed legal approval migration';
  end if;
end $$;
alter table agreement_resource_bindings alter column legal_gate_receipt_id set not null;
insert into schema_migrations(version) values ('0048_binding_legal_approval');
commit;
