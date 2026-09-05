import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { inTransaction, TransactionalOutboxRepository } from "./database.js";
import { reserveInventory } from "./inventory_allocations.js";
import { decimal } from "../money.js";

/**
 * Release renewal slots that were reserved while quoting but never bound to
 * a protected trade.  This runs independently of a particular recurrence
 * workflow, so an abandoned/failed worker cannot strand authorization
 * capacity forever.  COMMITTED rows are intentionally left alone: they are
 * bound to a concrete trade and are released only by that trade's terminal
 * settlement/dispute path.
 */
export async function sweepExpiredRenewalReservations(pool: Pool): Promise<number> {
  return inTransaction(pool, async (client) => {
    const result = await client.query(
      `with expired as (
         update standing_renewal_reservations
            set state='RELEASED', released_at=coalesce(released_at, now())
          where state='RESERVED' and expires_at<=now()
          returning candidate_id, demand_id, demand_version
       ), counts as (
         select demand_id, demand_version, count(*)::int releases
           from expired group by demand_id, demand_version
       ), decremented as (
         update standing_demand_authorizations a
            set renewals_reserved=greatest(a.renewals_reserved-counts.releases,0)
           from counts
          where a.demand_id=counts.demand_id
            and a.demand_version=counts.demand_version
          returning a.demand_id, a.demand_version
       )
       update recurring_candidates c
          set status='EXPIRED',
              failure_reason='RESERVATION_EXPIRED',
              updated_at=now()
         from expired e
        where c.id=e.candidate_id
          and c.status in('ECONOMICS_PENDING','PRICE_APPROVAL_REQUIRED','PRICE_APPROVED')
       returning c.id`,
    );
    return result.rowCount ?? 0;
  });
}

export async function protectApprovedRecurringMatch(
  pool: Pool,
  client: PoolClient,
  matchId: string,
  candidateId: string,
): Promise<{ readonly relationshipId:string;readonly tradeId:string }> {
  const facts=(await client.query(
    "select c.id,c.relationship_id prior_relationship_id,c.reservation_id,fe.realized_commission_per_kg,fe.currency,o.id offer_id,o.version offer_version,o.supplier_id,d.id demand_id,d.version demand_version,d.quantity_mt,d.buyer_id,case when sj.country_code='IN' and bj.country_code='IN' then 'DOMESTIC_INDIA' else 'INTERNATIONAL' end geography,exists(select 1 from documentary_lc_route_evidence l join document_checks dc on dc.id=l.document_check_id and dc.state='VERIFIED' and (dc.valid_until is null or dc.valid_until>now()) where l.relationship_id=c.relationship_id and l.valid_until>now()) has_lc from recurring_candidates c join standing_renewal_reservations r on r.id=c.reservation_id and r.state='RESERVED' and r.expires_at>now() join final_economics_snapshots fe on fe.match_id=c.match_id join matches m on m.id=c.match_id join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version join organization_jurisdictions sj on sj.organization_id=o.supplier_id and sj.state='VERIFIED' and sj.valid_until>now() join organization_jurisdictions bj on bj.organization_id=d.buyer_id and bj.state='VERIFIED' and bj.valid_until>now() where c.id=$1 and c.match_id=$2 and c.status in('ECONOMICS_PENDING','PRICE_APPROVED','PRICE_APPROVAL_REQUIRED') for update of c",
    [candidateId,matchId],
  )).rows[0];
  if(!facts)throw new Error("approved recurring candidate unavailable");
  const relationshipId=String(facts.prior_relationship_id),tradeId=randomUUID(),snapshot=(await client.query("select id,waterfall_digest from final_economics_snapshots where match_id=$1",[matchId])).rows[0];
  if(!snapshot)throw new Error("recurring final economics unavailable");
  const relationship=(await client.query("select id from protected_relationships where id=$1 and status='PROTECTED' and protected_until>now() for share",[relationshipId])).rows[0];
  if(!relationship)throw new Error("recurring protected relationship unavailable");
  await client.query(
    "insert into trades(id,match_id,supplier_id,buyer_id,relationship_id,state,geography,relationship_maturity,has_documentary_lc) values($1,$2,$3,$4,$5,'PROTECTED',$6,'ESTABLISHED',$7)",
    [tradeId,matchId,facts.supplier_id,facts.buyer_id,relationshipId,facts.geography,facts.has_lc],
  );
  await reserveInventory(client, {
    offerId: String(facts.offer_id),
    offerVersion: Number(facts.offer_version),
    demandId: String(facts.demand_id),
    demandVersion: Number(facts.demand_version),
    tradeId,
    quantityMt: decimal(String(facts.quantity_mt)),
  });
  const termsDigest=createHash("sha256").update(JSON.stringify({relationshipId,tradeId,finalEconomicsSnapshotId:snapshot.id,commissionRate:String(facts.realized_commission_per_kg),currency:String(facts.currency),waterfallDigest:String(snapshot.waterfall_digest)})).digest("hex");
  await client.query("insert into protected_transaction_terms(id,relationship_id,trade_id,final_economics_snapshot_id,commission_rate,currency,terms_digest) values($1,$2,$3,$4,$5,$6,$7)",[randomUUID(),relationshipId,tradeId,snapshot.id,facts.realized_commission_per_kg,facts.currency,termsDigest]);
  const updated=await client.query(
    "update recurring_candidates set relationship_id=$2,trade_id=$3,status='TRADE_PROTECTED',updated_at=now() where id=$1 and trade_id is null and status in('ECONOMICS_PENDING','PRICE_APPROVED','PRICE_APPROVAL_REQUIRED')",
    [candidateId,relationshipId,tradeId],
  );
  if((updated.rowCount??0)!==1)throw new Error("recurring candidate promotion conflict");
  const committed=await client.query("update standing_renewal_reservations set state='COMMITTED',committed_at=now(),trade_id=$2,final_economics_snapshot_id=$3 where id=$1 and state='RESERVED' and expires_at>now()",[facts.reservation_id,tradeId,snapshot.id]);
  if((committed.rowCount??0)!==1)throw new Error("recurring reservation commitment conflict");
  await new TransactionalOutboxRepository(pool).append(client,{
    id:randomUUID(),aggregateType:"TRADE",aggregateId:tradeId,eventType:"TRADE_PROTECTED",
    payload:{matchId,tradeId,candidateId,reservationId:facts.reservation_id},
    idempotencyKey:`trade:${tradeId}:protected`,
  });
  return Object.freeze({relationshipId,tradeId});
}

export async function releaseRecurringReservation(
  client:PoolClient,
  candidateId:string,
  terminalState:"DECLINED"|"EXPIRED"|"FAILED",
):Promise<void>{
  const released=(await client.query(
    "update standing_renewal_reservations r set state='RELEASED',released_at=now() from recurring_candidates c where c.id=$1 and c.reservation_id=r.id and r.state in('RESERVED','COMMITTED') returning r.demand_id,r.demand_version",
    [candidateId],
  )).rows[0];
  if(released)await client.query(
    "update standing_demand_authorizations set renewals_reserved=greatest(renewals_reserved-1,0) where demand_id=$1 and demand_version=$2",
    [released.demand_id,released.demand_version],
  );
  await client.query("update recurring_candidates set status=$2,updated_at=now() where id=$1 and status in('PRICE_APPROVAL_REQUIRED','PRICE_APPROVED','ECONOMICS_PENDING')",[candidateId,terminalState]);
}
