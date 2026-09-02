begin;
drop table if exists match_candidate_sweeps;
drop table if exists economic_quote_spend_reservations;
delete from schema_migrations where version='0055_quote_spend_caps';
commit;
