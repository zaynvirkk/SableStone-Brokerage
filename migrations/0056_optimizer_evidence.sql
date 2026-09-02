begin;
create table fulfillment_measurements(
 id uuid primary key,
 trade_id uuid not null unique references trades(id),
 contracted_quantity_mt numeric not null check(contracted_quantity_mt>0),
 fulfilled_quantity_mt numeric not null check(fulfilled_quantity_mt>=0 and fulfilled_quantity_mt<=contracted_quantity_mt),
 evidence_document_id uuid not null references documents(id),
 measured_at timestamptz not null
);
create trigger fulfillment_measurements_no_update_delete before update or delete on fulfillment_measurements for each row execute function reject_domain_event_mutation();
insert into schema_migrations(version) values('0056_optimizer_evidence');
commit;
