begin;

alter table cost_components
 add column payer_role text not null default 'UNKNOWN'
  check(payer_role in('BUYER','SUPPLIER','SABLESTONE','UNKNOWN')),
 add column settlement_treatment text not null default 'UNCLASSIFIED'
  check(settlement_treatment in('SUPPLIER_ENTITLEMENT','THIRD_PARTY_ALLOCATION','BUYER_DIRECT','SUPPLIER_DIRECT','PROVIDER_DEDUCTED','WITHHELD_RESERVE','UNCLASSIFIED')),
 add column beneficiary_role text
  check(beneficiary_role is null or beneficiary_role in('SUPPLIER','THIRD_PARTY','PROVIDER','RESERVE')),
 add column beneficiary_id uuid references organizations(id);
update cost_components set payer_role='BUYER',settlement_treatment='SUPPLIER_ENTITLEMENT',beneficiary_role='SUPPLIER'
 where cost_kind='SUPPLIER_NET';

do $$ begin
 if exists(select 1 from final_economics_snapshots) then
  raise exception 'existing final economics require receipt-backed waterfall classification';
 end if;
 if exists(select 1 from settlement_instructions) then
  raise exception 'existing settlement instructions require receipt-backed waterfall classification';
 end if;
end $$;

alter table final_economics_snapshots
 add column settlement_supplier_per_kg numeric not null check(settlement_supplier_per_kg>=0),
 add column settlement_gross_per_kg numeric not null check(settlement_gross_per_kg>0),
 add column buyer_direct_per_kg numeric not null check(buyer_direct_per_kg>=0),
 add column third_party_allocations jsonb not null,
 add column provider_deductions jsonb not null,
 add column reserve_allocations jsonb not null,
 add column buyer_direct_costs jsonb not null,
 add column waterfall_digest text not null check(waterfall_digest~'^[0-9a-f]{64}$'),
 add constraint final_economics_buyer_all_in_check
  check(settlement_gross_per_kg+buyer_direct_per_kg=accepted_buyer_price_per_kg);
create function validate_final_economics_waterfall() returns trigger language plpgsql as $$
declare allocated numeric;
begin
 select new.settlement_supplier_per_kg+new.realized_commission_per_kg
  +coalesce((select sum((value->>'amountPerKg')::numeric) from jsonb_array_elements(new.third_party_allocations) value),0)
  +coalesce((select sum((value->>'amountPerKg')::numeric) from jsonb_array_elements(new.provider_deductions) value),0)
  +coalesce((select sum((value->>'amountPerKg')::numeric) from jsonb_array_elements(new.reserve_allocations) value),0)
  into allocated;
 if allocated<>new.settlement_gross_per_kg then raise exception 'final economics settlement allocation mismatch'; end if;
 return new;
end $$;
create trigger final_economics_waterfall_validate before insert on final_economics_snapshots
 for each row execute function validate_final_economics_waterfall();

alter table settlement_instructions
 add column final_economics_snapshot_id uuid not null references final_economics_snapshots(id),
 add column buyer_all_in_amount numeric not null check(buyer_all_in_amount>0),
 add column buyer_direct_costs jsonb not null,
 add column provider_deductions jsonb not null,
 add column waterfall_digest text not null check(waterfall_digest~'^[0-9a-f]{64}$');

alter table matches
 add column priority_state text not null default 'HEURISTIC' check(priority_state in('HEURISTIC','CALIBRATED')),
 add column priority_source_digest text,
 add column expected_days_to_cash numeric not null default 30 check(expected_days_to_cash>0);

insert into schema_migrations(version) values('0054_explicit_waterfall_and_opportunity_set');
commit;
