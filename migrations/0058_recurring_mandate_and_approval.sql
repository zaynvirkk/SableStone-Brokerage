begin;
alter table standing_demand_authorizations
 add column buyer_id uuid references organizations(id),
 add column product_family text,
 add column product_spec jsonb;
update standing_demand_authorizations a set
 buyer_id=d.buyer_id,
 product_family=d.product_family,
 product_spec=d.product_spec
from buyer_demands d where d.id=a.demand_id and d.version=a.demand_version;
alter table standing_demand_authorizations
 alter column buyer_id set not null,
 alter column product_family set not null,
 alter column product_spec set not null;

alter table recurring_candidates drop constraint recurring_candidates_status_check;
do $$ declare candidate_constraint text;begin
 select conname into candidate_constraint from pg_constraint where conrelid='recurring_candidates'::regclass and contype='u' and pg_get_constraintdef(oid) like '%relationship_id, offer_id, offer_version, demand_id, demand_version%';
 if candidate_constraint is not null then execute format('alter table recurring_candidates drop constraint %I',candidate_constraint);end if;
end $$;
alter table recurring_candidates
 add column execution_demand_id uuid,
 add column execution_demand_version integer,
 add constraint recurring_candidates_status_check check(status in('ECONOMICS_PENDING','PRICE_APPROVAL_REQUIRED','PRICE_APPROVED','TRADE_PROTECTED','FEE_LOCKED','DECLINED','FAILED','EXPIRED'));
alter table negotiations add column recurring_candidate_id uuid unique references recurring_candidates(id);
create index standing_demand_due on standing_demand_authorizations(next_required_at) where automatic_renewal_permitted;
insert into schema_migrations(version) values('0058_recurring_mandate_and_approval');
commit;
