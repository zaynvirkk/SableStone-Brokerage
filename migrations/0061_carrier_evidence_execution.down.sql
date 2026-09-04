begin;
drop table if exists carrier_profiles;
delete from schema_migrations where version='0061_carrier_evidence_execution';
commit;
