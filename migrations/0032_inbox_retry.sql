begin;
alter table external_event_inbox add column if not exists attempts integer not null default 0 check(attempts>=0);
alter table external_event_inbox add column if not exists last_error_code text;
insert into schema_migrations(version) values('0032_inbox_retry') on conflict do nothing;
commit;
