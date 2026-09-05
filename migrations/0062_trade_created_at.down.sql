begin;
drop index if exists trades_created_at_idx;
alter table trades drop column if exists created_at;
delete from schema_migrations where version='0062_trade_created_at';
commit;
