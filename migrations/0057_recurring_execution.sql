begin;
alter table standing_demand_authorizations rename column renewals_used to renewals_consumed;
alter table standing_demand_authorizations
 add column renewals_reserved integer not null default 0 check(renewals_reserved>=0),
 add column quantity_per_cycle_mt numeric,
 add column quantity_tolerance_mt numeric not null default 0 check(quantity_tolerance_mt>=0),
 add column cadence_days integer,
 add column next_required_at timestamptz,
 add column maximum_all_in_price_per_kg numeric,
 add column currency char(3),
 add column supplier_scope text not null default 'SAME_SUPPLIER' check(supplier_scope in('SAME_SUPPLIER','APPROVED_SUBSTITUTION'));
update standing_demand_authorizations a set
 quantity_per_cycle_mt=d.quantity_mt,
 cadence_days=30,
 next_required_at=a.confirmed_at+interval '30 days',
 maximum_all_in_price_per_kg=d.buyer_ceiling,
 currency=d.currency,
 automatic_renewal_permitted=a.automatic_renewal_permitted and d.ceiling_state='KNOWN'
from buyer_demands d where d.id=a.demand_id and d.version=a.demand_version;
alter table standing_demand_authorizations
 alter column quantity_per_cycle_mt set not null,
 alter column cadence_days set not null,
 alter column next_required_at set not null,
 add constraint standing_authorization_capacity check(renewals_reserved+renewals_consumed<=maximum_renewals),
 add constraint standing_authorization_execution_bounds check(not automatic_renewal_permitted or(maximum_all_in_price_per_kg is not null and currency is not null and cadence_days>0));

alter table recurring_candidates drop constraint if exists recurring_candidates_status_check;
alter table recurring_candidates
 add column match_id uuid references matches(id),
 add column trade_id uuid references trades(id),
 add column reservation_id uuid,
 add column failure_reason text,
 add column updated_at timestamptz not null default now();
update recurring_candidates set status='EXPIRED',failure_reason='LEGACY_CANDIDATE_NOT_EXECUTABLE' where status='MATCHED_REQUIRES_NEW_FEE_LOCK';
alter table recurring_candidates add constraint recurring_candidates_status_check check(status in('ECONOMICS_PENDING','PRICE_APPROVAL_REQUIRED','TRADE_PROTECTED','FEE_LOCKED','FAILED','EXPIRED'));
alter table recurring_candidates add constraint recurring_candidates_live_binding check(status in('FAILED','EXPIRED') or match_id is not null);

create table standing_renewal_reservations(
 id uuid primary key,
 demand_id uuid not null,
 demand_version integer not null,
 candidate_id uuid not null unique references recurring_candidates(id),
 cycle_number integer not null check(cycle_number>0),
 state text not null check(state in('RESERVED','CONSUMED','RELEASED')),
 reserved_at timestamptz not null,
 expires_at timestamptz not null,
 consumed_at timestamptz,
 released_at timestamptz,
 foreign key(demand_id,demand_version) references standing_demand_authorizations(demand_id,demand_version),
 check(expires_at>reserved_at)
);
alter table recurring_candidates add constraint recurring_candidates_reservation_fk foreign key(reservation_id) references standing_renewal_reservations(id) deferrable initially deferred;
create index standing_renewal_reservations_expiry on standing_renewal_reservations(expires_at) where state='RESERVED';
create unique index standing_renewal_reservations_live_cycle on standing_renewal_reservations(demand_id,demand_version,cycle_number) where state in('RESERVED','CONSUMED');
insert into schema_migrations(version) values('0057_recurring_execution');
commit;
