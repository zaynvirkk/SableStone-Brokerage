begin;

-- Economic priority needs a durable trade start timestamp. Existing rows are
-- backfilled from their current lifecycle timestamp; no historical funding or
-- settlement fact is fabricated.
alter table trades add column if not exists created_at timestamptz;
update trades set created_at=updated_at where created_at is null;
alter table trades alter column created_at set default now();
alter table trades alter column created_at set not null;
create index if not exists trades_created_at_idx on trades(created_at);

insert into schema_migrations(version) values('0062_trade_created_at') on conflict do nothing;
commit;
