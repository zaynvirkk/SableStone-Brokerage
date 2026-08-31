begin;
create table if not exists connector_leases(
 connector text not null,
 scope text not null,
 external_reference text not null,
 expires_at timestamptz not null,
 renewed_at timestamptz not null,
 primary key(connector,scope)
);
insert into schema_migrations(version) values('0031_connector_leases') on conflict do nothing;
commit;
