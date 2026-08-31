begin;
create unique index if not exists trades_match_relationship_unique
on trades(match_id, relationship_id)
where match_id is not null and relationship_id is not null;
insert into schema_migrations(version)
values('0029_protected_trade_reachability')
on conflict do nothing;
commit;
