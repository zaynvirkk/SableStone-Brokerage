begin;
create table if not exists trade_contract_acceptances(
 id uuid primary key,
 trade_id uuid not null references trades(id),
 role text not null check(role in('SUPPLIER','BUYER')),
 organization_id uuid not null references organizations(id),
 agreement_acceptance_id uuid not null references agreement_acceptances(id),
 accepted_at timestamptz not null,
 unique(trade_id,role),
 unique(trade_id,organization_id)
);
create table if not exists delivery_acceptances(
 id uuid primary key,
 trade_id uuid not null unique references trades(id),
 buyer_id uuid not null references organizations(id),
 delivered_shipment_event_id uuid not null references shipment_events(event_id),
 acceptance_kind text not null check(acceptance_kind in('ACCEPTED','INSPECTION_PASS','COA_WAIVER')),
 evidence_receipt_id uuid,
 accepted_at timestamptz not null
);
create trigger trade_contract_acceptances_no_update_delete before update or delete on trade_contract_acceptances for each row execute function reject_domain_event_mutation();
create trigger delivery_acceptances_no_update_delete before update or delete on delivery_acceptances for each row execute function reject_domain_event_mutation();
insert into schema_migrations(version) values('0034_trade_acceptances') on conflict do nothing;
commit;
