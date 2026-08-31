create table if not exists external_event_inbox(
 provider text not null, external_event_id text not null, payload_digest text not null check(payload_digest ~ '^[0-9a-f]{64}$'), payload_object_key text not null,
 received_at timestamptz not null, signature_verified boolean not null check(signature_verified), processing_state text not null check(processing_state in('PENDING','PROCESSING','PROCESSED','REJECTED')), processed_at timestamptz,
 claimed_at timestamptz,
 primary key(provider,external_event_id)
);
alter table transactional_outbox add column if not exists idempotency_key text;
alter table transactional_outbox add column if not exists state text not null default 'PENDING' check(state in('PENDING','PROCESSING','PUBLISHED','FAILED'));
alter table transactional_outbox add column if not exists attempts integer not null default 0 check(attempts>=0);
alter table transactional_outbox add column if not exists claimed_at timestamptz;
update transactional_outbox set idempotency_key='legacy:'||event_id::text where idempotency_key is null;
alter table transactional_outbox alter column idempotency_key set not null;
create unique index if not exists transactional_outbox_idempotency on transactional_outbox(idempotency_key);
create table if not exists trades(
 id uuid primary key, supplier_id uuid not null references organizations(id), buyer_id uuid not null references organizations(id), relationship_id uuid,
 state text not null check(state in('MATCHED','NEGOTIATING','PROTECTED','FEE_LOCKED','IDENTITY_RELEASED','CONTRACTED','FUNDED','DISPATCHED','IN_TRANSIT','DELIVERED','ACCEPTED','SETTLED','RECURRING','REJECTED','EXPIRED','CANCELLED','DISPUTED_FROZEN','SETTLEMENT_FAILED')),
 updated_at timestamptz not null default now()
);
create index if not exists external_event_inbox_pending on external_event_inbox(received_at) where processing_state in('PENDING','PROCESSING');
create index if not exists transactional_outbox_pending on transactional_outbox(created_at) where state in('PENDING','PROCESSING');
insert into schema_migrations(version) values('0025_production_runtime') on conflict do nothing;
