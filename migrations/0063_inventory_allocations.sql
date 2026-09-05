begin;

create table if not exists offer_inventory_allocations(
  id uuid primary key,
  offer_id uuid not null,
  offer_version integer not null,
  trade_id uuid not null references trades(id),
  quantity_mt numeric not null check(quantity_mt>0),
  state text not null check(state in('RESERVED','COMMITTED','CONSUMED','RELEASED')),
  reserved_at timestamptz not null default now(),
  committed_at timestamptz,
  consumed_at timestamptz,
  released_at timestamptz,
  unique(offer_id,offer_version,trade_id),
  foreign key(offer_id,offer_version) references supplier_offers(id,version)
);
create index if not exists offer_inventory_allocations_active on offer_inventory_allocations(offer_id,offer_version) where state in('RESERVED','COMMITTED','CONSUMED');

create table if not exists demand_inventory_allocations(
  id uuid primary key,
  demand_id uuid not null,
  demand_version integer not null,
  trade_id uuid not null references trades(id),
  quantity_mt numeric not null check(quantity_mt>0),
  state text not null check(state in('RESERVED','COMMITTED','CONSUMED','RELEASED')),
  reserved_at timestamptz not null default now(),
  committed_at timestamptz,
  consumed_at timestamptz,
  released_at timestamptz,
  unique(demand_id,demand_version,trade_id),
  foreign key(demand_id,demand_version) references buyer_demands(id,version)
);
create index if not exists demand_inventory_allocations_active on demand_inventory_allocations(demand_id,demand_version) where state in('RESERVED','COMMITTED','CONSUMED');

insert into schema_migrations(version) values('0063_inventory_allocations') on conflict do nothing;
commit;
