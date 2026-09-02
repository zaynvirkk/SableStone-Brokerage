begin;
drop table if exists fulfillment_measurements;
delete from schema_migrations where version='0056_optimizer_evidence';
commit;
