begin;
create table if not exists inbound_message_decisions(
 id uuid primary key,
 communication_id uuid not null unique references communications(id),
 classification text not null check(classification in('SUPPLIER_OFFER','BUYER_RFQ','COUNTEROFFER','DOCUMENT','EXCEPTION')),
 decision_state text not null check(decision_state in('PROPOSED','REQUEST_MISSING_FIELDS','DECLINE','ROUTE_DOCUMENTS')),
 decision_digest text not null check(decision_digest ~ '^[0-9a-f]{64}$'),
 decision jsonb not null,
 created_at timestamptz not null default now()
);
create table if not exists outbound_email_jobs(
 id uuid primary key,
 idempotency_key text not null unique,
 source_communication_id uuid not null references communications(id),
 thread_id text not null,
 recipient_ciphertext bytea not null,
 recipient_lookup_hash text not null,
 subject text not null,
 message_id text not null unique,
 mime_object_key text not null,
 mime_sha256 text not null check(mime_sha256 ~ '^[0-9a-f]{64}$'),
 state text not null check(state in('PENDING','PROCESSING','SENT','SUPPRESSED','FAILED')),
 attempts integer not null default 0 check(attempts>=0),
 claimed_at timestamptz,
 provider_message_id text,
 provider_thread_id text,
 sent_at timestamptz,
 last_error_code text,
 created_at timestamptz not null default now()
);
create index if not exists outbound_email_jobs_pending on outbound_email_jobs(created_at) where state in('PENDING','PROCESSING');
create table if not exists settlement_provider_events(
 id uuid primary key,
 provider text not null,
 external_event_id text not null,
 provider_reference text not null,
 trade_id uuid not null references trades(id),
 event_type text not null check(event_type in('FUNDED','DISBURSEMENT_REPORTED','FAILED','REVERSED','DISPUTE_OPENED')),
 amount numeric,
 currency char(3),
 occurred_at timestamptz not null,
 payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
 payload_object_key text not null,
 created_at timestamptz not null default now(),
 unique(provider,external_event_id)
);
create trigger inbound_message_decisions_no_update_delete before update or delete on inbound_message_decisions for each row execute function reject_domain_event_mutation();
create trigger settlement_provider_events_no_update_delete before update or delete on settlement_provider_events for each row execute function reject_domain_event_mutation();
insert into schema_migrations(version) values('0030_production_event_processing') on conflict do nothing;
commit;
