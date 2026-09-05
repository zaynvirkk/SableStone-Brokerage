begin;
drop table if exists demand_inventory_allocations;
drop table if exists offer_inventory_allocations;
delete from schema_migrations where version='0063_inventory_allocations';
commit;
