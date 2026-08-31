begin;
create table if not exists workflow_stage_receipts(
 id uuid primary key, stage text not null, input_digest text not null check(input_digest ~ '^[0-9a-f]{64}$'), result_digest text not null check(result_digest ~ '^[0-9a-f]{64}$'),
 state text not null check(state in('ACCEPTED','REJECTED','UNKNOWN')), source_receipt_ids text[] not null, facts jsonb not null, created_at timestamptz not null default now(),
 unique(stage,result_digest), check(state<>'ACCEPTED' or cardinality(source_receipt_ids)>0)
);
insert into schema_migrations(version) values('0027_workflow_runtime') on conflict do nothing;
commit;

