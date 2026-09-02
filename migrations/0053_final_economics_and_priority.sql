begin;
create table final_economics_snapshots(
 id uuid primary key,
 match_id uuid not null unique references matches(id),
 negotiation_id uuid not null unique references negotiations(id),
 negotiation_decision_id uuid not null unique references negotiation_decisions(id),
 negotiation_revision integer not null check(negotiation_revision>=0),
 accepted_buyer_price_per_kg numeric not null check(accepted_buyer_price_per_kg>0),
 supplier_net_per_kg numeric not null check(supplier_net_per_kg>=0),
 freight_per_kg numeric not null check(freight_per_kg>=0),
 inspection_per_kg numeric not null check(inspection_per_kg>=0),
 payment_rail_per_kg numeric not null check(payment_rail_per_kg>=0),
 tax_charge_per_kg numeric not null check(tax_charge_per_kg>=0),
 risk_reserve_per_kg numeric not null check(risk_reserve_per_kg>=0),
 economic_floor_per_kg numeric not null check(economic_floor_per_kg>=0),
 realized_commission_per_kg numeric not null check(realized_commission_per_kg>0),
 cost_component_digest text not null check(cost_component_digest~'^[0-9a-f]{64}$'),
 currency char(3) not null,
 accepted_at timestamptz not null,
 check(supplier_net_per_kg+freight_per_kg+inspection_per_kg+payment_rail_per_kg+tax_charge_per_kg+risk_reserve_per_kg=economic_floor_per_kg),
 check(economic_floor_per_kg+realized_commission_per_kg=accepted_buyer_price_per_kg)
);
create trigger final_economics_snapshots_no_update_delete before update or delete on final_economics_snapshots for each row execute function reject_domain_event_mutation();
alter table protected_relationships add column if not exists final_economics_snapshot_id uuid references final_economics_snapshots(id);
do $$ begin
 if exists(select 1 from protected_relationships where final_economics_snapshot_id is null) then
  raise exception 'protected relationship lacks final accepted economics; receipt-backed migration required';
 end if;
end $$;
alter table protected_relationships alter column final_economics_snapshot_id set not null;
alter table protected_relationships add constraint protected_relationships_final_economics_unique unique(final_economics_snapshot_id);

alter table acquisition_outreach_jobs add column if not exists priority_score numeric not null default 0;
alter table acquisition_outreach_jobs add column if not exists priority_state text not null default 'HEURISTIC' check(priority_state in('HEURISTIC','CALIBRATED'));
alter table acquisition_outreach_jobs add column if not exists priority_source_digest text;
alter table acquisition_profiles add column if not exists segment_id text;
alter table workflow_schedules add column if not exists priority_score numeric not null default 0;
alter table matches add column if not exists priority_score numeric not null default 0;
create index acquisition_outreach_jobs_value_priority on acquisition_outreach_jobs(priority_score desc,created_at) where state in('WAITING_CONTACT','WAITING_RISK','WAITING_PROFILE','WAITING_INVENTORY','READY','PROCESSING');
create index workflow_schedules_value_priority on workflow_schedules(priority_score desc,next_run_at) where state='ACTIVE';
create index matches_value_priority on matches(priority_score desc,evaluated_at) where compatible;

insert into schema_migrations(version) values('0053_final_economics_and_priority');
commit;
