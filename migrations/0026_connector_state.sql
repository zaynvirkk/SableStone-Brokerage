begin;
create table if not exists connector_cursors(
 connector text not null, scope text not null, cursor text not null, version integer not null default 1 check(version>0), updated_at timestamptz not null default now(),
 primary key(connector,scope)
);
create table if not exists source_fetch_receipts(
 id uuid primary key, source_kind text not null, canonical_url text not null, retrieved_at timestamptz not null, status_code integer not null,
 body_sha256 text not null check(body_sha256 ~ '^[0-9a-f]{64}$'), body_object_key text not null, parser_version text not null,
 unique(source_kind,canonical_url,body_sha256)
);
create table if not exists acquisition_graph_nodes(
 id text primary key, organization_id uuid not null references organizations(id), role text not null check(role in('SUPPLIER','BUYER')),
 evidence_receipt_ids text[] not null check(cardinality(evidence_receipt_ids)>0), classification_state text not null check(classification_state in('SOURCE_STATED','UNKNOWN')),
 attributes jsonb not null, created_at timestamptz not null default now()
);
insert into schema_migrations(version) values('0026_connector_state') on conflict do nothing;
commit;

