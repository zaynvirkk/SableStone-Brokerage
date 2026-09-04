import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { StageHandler, StageName, StageResult } from "./activities.js";
import type {
  SettlementAdapter,
  SettlementInstructionDraft,
} from "../settlement.js";
import { routeSettlement } from "../router.js";
import { decimal, multiplyDecimal, maxDecimal, minDecimal, subtractDecimal, divideDecimal } from "../money.js";
import { settlementInstructionAcceptanceDigest } from "./commands.js";
import { inTransaction, TransactionalOutboxRepository } from "./database.js";
import type { ProductionDiscoveryService } from "./discovery_service.js";
import { reconcileTradeAccounting } from "./accounting.js";
import { compareDecimalStrings, known } from "../domain.js";
import { expectedProfitPriority } from "../pricing.js";
import type { ProviderPartyReferenceResolver } from "./provider_parties.js";
import { releaseRecurringReservation } from "./recurring_execution.js";

const accepted = (
  receipt: string,
  facts: Readonly<Record<string, unknown>>,
): StageResult => ({
  state: "ACCEPTED",
  sourceReceiptIds: Object.freeze([receipt]),
  facts,
});
const unknown = (reason: string): StageResult => ({
  state: "UNKNOWN",
  sourceReceiptIds: Object.freeze([]),
  facts: Object.freeze({ reason }),
});
const rejected = (receipt: string, reason: string): StageResult => ({
  state: "REJECTED",
  sourceReceiptIds: Object.freeze([receipt]),
  facts: Object.freeze({ reason }),
});
const receipt = (row: QueryResultRow, prefix: string) =>
  `${prefix}:${row.id ?? row.event_id ?? row.external_event_id}`;

export function buildDatabaseStageHandlers(
  pool: Pool,
  adapters: readonly SettlementAdapter[] = [],
  discovery?: ProductionDiscoveryService,
  providerParties?: ProviderPartyReferenceResolver,
): Readonly<Partial<Record<StageName, StageHandler>>> {
  return Object.freeze({
    DISCOVER_SUPPLIER: async (input) =>
      runDiscovery(discovery, String(input.sourceId), "SUPPLIER"),
    DISCOVER_BUYER: async (input) =>
      runDiscovery(discovery, String(input.sourceId), "BUYER"),
    QUALIFY: async (input) => {
      const role = String(input.role),
        subject = role === "SUPPLIER" ? "SUPPLIER_OFFER" : "BUYER_DEMAND",
        result = await pool.query(
          "select * from qualification_decisions where organization_id=$1 and subject_type=$2 order by decided_at desc limit 1",
          [input.organizationId, subject],
        ),
        row = result.rows[0];
      if (!row) return unknown("qualification decision missing");
      return row.verdict === "PASS"
        ? accepted(receipt(row, "qualification"), {
            verdict: row.verdict,
            subjectId: row.subject_id,
            subjectVersion: row.subject_version,
          })
        : rejected(receipt(row, "qualification"), String(row.verdict));
    },
    MATCH: async (input) => {
      const now = new Date().toISOString(),
        offerAuto = String(input.offerId) === "AUTO_SELECT",
        demandAuto = String(input.demandId) === "AUTO_SELECT";
      if (offerAuto === demandAuto)
        return unknown("matching requires exactly one anchored offer or demand");
      const anchoredOffers = offerAuto
          ? null
          : await pool.query(
              "select * from supplier_offers where id=$1 order by version desc limit 1",
              [input.offerId],
            ),
        anchoredDemands = demandAuto
          ? null
          : await pool.query(
              "select * from buyer_demands where id=$1 order by version desc limit 1",
              [input.demandId],
            );
      if ((!offerAuto && !anchoredOffers?.rows[0]) || (!demandAuto && !anchoredDemands?.rows[0]))
        return unknown("anchored offer or demand unavailable");
      const anchor = (offerAuto ? anchoredDemands : anchoredOffers)!.rows[0]!,
        anchorType = offerAuto ? "DEMAND" : "OFFER";
      await pool.query(
        "insert into match_candidate_sweeps(id,anchor_type,anchor_id,anchor_version,state) values(gen_random_uuid(),$1,$2,$3,'PENDING') on conflict(anchor_type,anchor_id,anchor_version) do nothing",
        [anchorType, anchor.id, anchor.version],
      );
      const sweep = (
          await pool.query(
            "update match_candidate_sweeps set state='PROCESSING',claimed_at=now() where anchor_type=$1 and anchor_id=$2 and anchor_version=$3 and (state='PENDING' or(state='PROCESSING' and claimed_at<now()-interval '10 minutes')) returning *",
            [anchorType, anchor.id, anchor.version],
          )
        ).rows[0];
      if (!sweep) {
        const complete = (
          await pool.query(
            "select id,processed_count from match_candidate_sweeps where anchor_type=$1 and anchor_id=$2 and anchor_version=$3 and state='COMPLETED'",
            [anchorType, anchor.id, anchor.version],
          )
        ).rows[0];
        return complete
          ? accepted(`match-sweep:${complete.id}`, { candidateCount: Number(complete.processed_count), complete: true })
          : unknown("match candidate sweep already processing");
      }
      const batchSize = 250;
      const
        offers = offerAuto
          ? await executableCounterparts(
              pool,
              "supplier_offers",
              anchoredDemands!.rows[0]!,
              now,
              sweep.cursor_created_at,
              sweep.cursor_id,
              batchSize,
            )
          : anchoredOffers!,
        demands = demandAuto
          ? await executableCounterparts(
              pool,
              "buyer_demands",
              anchoredOffers!.rows[0]!,
              now,
              sweep.cursor_created_at,
              sweep.cursor_id,
              batchSize,
            )
          : anchoredDemands!,
        executableMatches: { id: string; offerId: string; demandId: string; priority: string }[] = [];
      for (const offer of offers.rows)
        for (const demand of demands.rows) {
          const gate = await matchGates(pool, offer, demand, now),
            reasons: string[] = [];
          if (offer.product_family !== demand.product_family)
            reasons.push("PRODUCT_FAMILY_MISMATCH");
          if (
            compareDecimalStrings(
              decimal(String(offer.quantity_mt)),
              decimal(String(demand.quantity_mt)),
            ) < 0
          )
            reasons.push("QUANTITY_UNAVAILABLE");
          if (
            compareDecimalStrings(
              decimal(String(demand.quantity_mt)),
              decimal(String(offer.moq_mt)),
            ) < 0
          )
            reasons.push("BELOW_MOQ");
          if (!deepCompatible(offer.product_spec, demand.product_spec))
            reasons.push("SPECIFICATION_MISMATCH");
          reasons.push(...gate.reasons);
          const preliminaryPriority = reasons.length === 0
              ? await preQuotePriority(pool, offer, demand, gate.geography, now)
              : "0",
            contextDigest = createHash("sha256")
              .update(
                JSON.stringify({
                  offer: offer.id,
                  offerVersion: offer.version,
                  demand: demand.id,
                  demandVersion: demand.version,
                  gate,
                }),
              )
              .digest("hex"),
            prior = await pool.query(
              "select id,compatible from matches where offer_id=$1 and offer_version=$2 and demand_id=$3 and demand_version=$4 and matcher_version='production-v1' and context_digest=$5",
              [
                offer.id,
                offer.version,
                demand.id,
                demand.version,
                contextDigest,
              ],
            );
          let id = prior.rows[0]?.id;
          if (!id) {
            const inserted = await pool.query(
              "insert into matches(id,offer_id,offer_version,demand_id,demand_version,compatible,rejection_reasons,matcher_version,context_digest,evaluated_at,priority_score) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,'production-v1',$7,$8,$9) returning id",
              [
                offer.id,
                offer.version,
                demand.id,
                demand.version,
                reasons.length === 0,
                JSON.stringify([...new Set(reasons)]),
                contextDigest,
                now,
                preliminaryPriority,
              ],
            );
            id = inserted.rows[0].id;
          }
          if (reasons.length === 0) {
            await pool.query(
              "update matches set priority_score=$2,priority_state='HEURISTIC',priority_source_digest=$3 where id=$1 and not exists(select 1 from pricing_decisions where match_id=$1 and state='EXECUTABLE')",
              [
                id,
                preliminaryPriority,
                createHash("sha256").update(JSON.stringify({ model: "prequote-ev-v2", preliminaryPriority, geography: gate.geography })).digest("hex"),
              ],
            );
            executableMatches.push({
              id,
              offerId: offer.id,
              demandId: demand.id,
              priority: preliminaryPriority,
            });
          }
        }
      const counterpartRows = offerAuto ? offers.rows : demands.rows,
        hasContinuation = counterpartRows.length === batchSize,
        lastCounterpart = counterpartRows.at(-1);
      await inTransaction(pool, async (client) => {
        await client.query(
          "update match_candidate_sweeps set state=$2,cursor_created_at=coalesce($3,cursor_created_at),cursor_id=coalesce($4,cursor_id),processed_count=processed_count+$5,claimed_at=null,completed_at=case when $2='COMPLETED' then now() else null end where id=$1 and state='PROCESSING'",
          [sweep.id, hasContinuation ? "PENDING" : "COMPLETED", lastCounterpart?.created_at ?? null, lastCounterpart?.id ?? null, counterpartRows.length],
        );
        if (hasContinuation)
          await new TransactionalOutboxRepository(pool).append(client, {
            id: randomUUID(),
            aggregateType: "MATCH_SWEEP",
            aggregateId: String(sweep.id),
            eventType: "MATCH_SWEEP_CONTINUE",
            payload: offerAuto
              ? { offerId: "AUTO_SELECT", demandId: anchor.id }
              : { offerId: anchor.id, demandId: "AUTO_SELECT" },
            idempotencyKey: `match-sweep:${sweep.id}:${lastCounterpart!.id}`,
          });
      });
      if (!hasContinuation)
        await ensureEconomicJobs(
          pool,
          anchorType,
          String(anchor.id),
          Number(anchor.version),
        );
      if (executableMatches.length) {
        executableMatches.sort((left, right) =>
          compareDecimalStrings(decimal(right.priority), decimal(left.priority)),
        );
        return accepted(`match-set:${createHash("sha256").update(executableMatches.map((value) => value.id).join(":" )).digest("hex")}`, {
          matchId: executableMatches[0]!.id,
          matchIds: executableMatches.map((value) => value.id),
          candidateCount: executableMatches.length,
          sweepComplete: !hasContinuation,
          offerId: executableMatches[0]!.offerId,
          demandId: executableMatches[0]!.demandId,
        });
      }
      return unknown("no executable compatible pair");
    },
    NEGOTIATE: async (input) => {
      const row = (
        await pool.query(
          "select d.* from negotiation_decisions d join negotiations n on n.id=d.negotiation_id where n.match_id=$1 order by d.decided_at desc limit 1",
          [input.matchId],
        )
      ).rows[0];
      if (!row) {
        const expired=(await pool.query("select id,recurring_candidate_id from negotiations where match_id=$1 and status='OPEN' and expires_at<=now()",[input.matchId])).rows[0];
        if(expired?.recurring_candidate_id){
          await inTransaction(pool,async(client)=>{
            await releaseRecurringReservation(client,expired.recurring_candidate_id,"EXPIRED");
            await client.query("update negotiations set status='EXPIRED' where id=$1 and status='OPEN'",[expired.id]);
          });
          return rejected(`negotiation:${expired.id}`,"recurring price approval expired");
        }
        return unknown("negotiation decision missing");
      }
      return row.action === "ACCEPT"
        ? accepted(receipt(row, "negotiation"), {
            action: row.action,
            price: row.executable_price_per_kg,
          })
        : row.action === "DECLINE"
          ? rejected(receipt(row, "negotiation"), row.reason)
          : unknown("negotiation not terminal");
    },
    PROTECT: async (input) => protectMatch(pool, String(input.matchId)),
    LOCK_SETTLEMENT: async (input) =>
      lockSettlement(
        pool,
        adapters,
        String(input.tradeId),
        String(input.provider),
        providerParties,
      ),
    RELEASE_IDENTITY: async (input) =>
      releaseIdentity(
        pool,
        String(input.tradeId),
        String(input.feeLockReceiptId),
      ),
    MONITOR_SHIPMENT: async (input) => {
      const row = (
        await pool.query(
          "select * from shipment_events where trade_id=$1 order by occurred_at desc limit 1",
          [input.tradeId],
        )
      ).rows[0];
      return row
        ? accepted(receipt(row, "shipment"), {
            eventType: row.event_type,
            occurredAt: row.occurred_at,
          })
        : unknown("shipment event missing");
    },
    RECONCILE: async (input) => {
      const state = await reconcileTradeAccounting(pool, String(input.tradeId));
      return state === "RECONCILED"
        ? accepted(`reconciliation:${input.tradeId}`, { state })
        : state === "MISMATCH"
          ? rejected(`reconciliation:${input.tradeId}`, state)
          : unknown(`bank reconciliation ${state}`);
    },
    RECURRENCE_SCHEDULE: async (input) => {
      const row = (await pool.query(
        "select a.next_required_at,a.valid_until,a.acceptance_digest from trades t join matches m on m.id=t.match_id left join recurring_candidates rc on rc.trade_id=t.id join standing_demand_authorizations a on a.demand_id=coalesce(rc.demand_id,m.demand_id) and a.demand_version=coalesce(rc.demand_version,m.demand_version) where t.id=$1 and t.state in('SETTLED','RECURRING') and a.automatic_renewal_permitted and a.renewals_reserved+a.renewals_consumed<a.maximum_renewals and a.valid_until>now()",
        [String(input.tradeId)],
      )).rows[0];
      return row
        ? accepted(`standing-authorization:${row.acceptance_digest}`, { nextRequiredAt:new Date(row.next_required_at).toISOString(), validUntil:new Date(row.valid_until).toISOString() })
        : unknown("standing recurrence schedule unavailable");
    },
    RECUR: async (input) =>
      createQualifiedRecurringMatch(pool, String(input.tradeId)),
  });
}
async function createQualifiedRecurringMatch(
  pool: Pool,
  tradeId: string,
): Promise<StageResult> {
  return inTransaction(pool, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `recurring-safe:${tradeId}`,
    ]);
    await client.query(
      "with expired as(update standing_renewal_reservations set state='RELEASED',released_at=now() where state='RESERVED' and expires_at<=now() returning demand_id,demand_version,candidate_id),counts as(select demand_id,demand_version,count(*) releases from expired group by demand_id,demand_version) update standing_demand_authorizations a set renewals_reserved=greatest(a.renewals_reserved-counts.releases,0) from counts where a.demand_id=counts.demand_id and a.demand_version=counts.demand_version",
    );
    await client.query(
      "update recurring_candidates c set status='EXPIRED',failure_reason='RESERVATION_EXPIRED',updated_at=now() from standing_renewal_reservations r where r.candidate_id=c.id and r.state='RELEASED' and c.status in('ECONOMICS_PENDING','PRICE_APPROVAL_REQUIRED','TRADE_PROTECTED')",
    );
    const prior = (
      await client.query(
        "select t.*,f.id fee_lock_id,pr.id protected_relationship_id,coalesce(rc.demand_id,m.demand_id) authorization_demand_id,coalesce(rc.demand_version,m.demand_version) authorization_demand_version from trades t join fee_locks f on f.trade_id=t.id join protected_relationships pr on pr.id=f.relationship_id join matches m on m.id=t.match_id left join recurring_candidates rc on rc.trade_id=t.id where t.id=$1 and t.state in('SETTLED','RECURRING') and pr.protected_until>now()",
        [tradeId],
      )
    ).rows[0];
    if (!prior) return unknown("settled protected relationship missing");
    const authorization = (
      await client.query(
        "select * from standing_demand_authorizations where demand_id=$1 and demand_version=$2 and automatic_renewal_permitted and renewals_reserved+renewals_consumed<maximum_renewals and valid_until>now() and next_required_at<=now() for update",
        [prior.authorization_demand_id, prior.authorization_demand_version],
      )
    ).rows[0];
    if (!authorization)
      return unknown("standing demand authorization unavailable");
    const existing = (
      await client.query(
        "select * from recurring_candidates where prior_fee_lock_id=$1 and status not in('FAILED','EXPIRED') order by created_at desc limit 1",
        [prior.fee_lock_id],
      )
    ).rows[0];
    if (existing)
      return accepted(receipt(existing, "recurring"), {
        candidateId: existing.id,
        status: existing.status,
      });
    if (authorization.supplier_scope !== "SAME_SUPPLIER")
      return unknown("approved substitution requires fresh protected-account acceptance");
    const buyerRisk=(await client.query("select state from risk_decisions where organization_id=$1 order by decided_at desc limit 1",[authorization.buyer_id])).rows[0];
    if(buyerRisk?.state!=="PASS")return unknown("recurring buyer risk gate failed");
    const offers = (await client.query(
      "select o.* from supplier_offers o where o.supplier_id=$1 and o.product_family=$2 and o.verification='VERIFIED' and o.freshness='CURRENT' and o.expires_at>now() and o.quantity_mt>=$3 and $3>=o.moq_mt and exists(select 1 from qualification_decisions q where q.subject_type='SUPPLIER_OFFER' and q.subject_id=o.id and q.subject_version=o.version and q.verdict='PASS') and exists(select 1 from risk_decisions r where r.organization_id=o.supplier_id and r.state='PASS') order by o.created_at desc",
      [prior.supplier_id,authorization.product_family,authorization.quantity_per_cycle_mt],
    )).rows;
    const pair=offers.find((offer)=>deepCompatible(offer.product_spec,authorization.product_spec));
    if (!pair)
      return unknown("no current fully-qualified compatible recurring match");
    const id = randomUUID(), matchId = randomUUID(), reservationId = randomUUID(),executionDemandId=randomUUID(),sourceEventId=randomUUID(),
      cycleNumber = Number(authorization.renewals_reserved)+Number(authorization.renewals_consumed)+1,
      contextDigest=createHash("sha256").update(JSON.stringify({recurringCandidate:id,priorFeeLock:prior.fee_lock_id,cycleNumber})).digest("hex");
    await client.query(
      "insert into domain_events(event_id,idempotency_key,aggregate_type,aggregate_id,event_type,event_time,policy_version,payload) values($1,$2,'BUYER_DEMAND',$3,'STANDING_DEMAND_CYCLE_CREATED',now(),'standing-mandate-v1',$4)",
      [sourceEventId,`standing:${authorization.acceptance_digest}:cycle:${cycleNumber}`,executionDemandId,{authorizationDemandId:authorization.demand_id,authorizationDemandVersion:authorization.demand_version,cycleNumber}],
    );
    await client.query(
      "insert into buyer_demands(id,version,buyer_id,source_event_id,product_family,product_spec,quantity_mt,buyer_ceiling,ceiling_state,currency,standing,expires_at,verification,freshness) values($1,1,$2,$3,$4,$5,$6,$7,'KNOWN',$8,true,$9,'VERIFIED','CURRENT')",
      [executionDemandId,authorization.buyer_id,sourceEventId,authorization.product_family,authorization.product_spec,authorization.quantity_per_cycle_mt,authorization.maximum_all_in_price_per_kg,authorization.currency,authorization.valid_until],
    );
    await client.query(
      "insert into qualification_decisions(id,organization_id,subject_type,subject_id,subject_version,verdict,reasons,policy_version,decided_at) values(gen_random_uuid(),$1,'BUYER_DEMAND',$2,1,'PASS','[]'::jsonb,$3,now())",
      [authorization.buyer_id,executionDemandId,`standing-authorization:${authorization.acceptance_digest}`],
    );
    await client.query(
      "insert into matches(id,offer_id,offer_version,demand_id,demand_version,compatible,rejection_reasons,matcher_version,context_digest,evaluated_at,priority_score) values($1,$2,$3,$4,$5,true,'[]'::jsonb,'recurring-v1',$6,now(),0)",
      [matchId,pair.id,pair.version,executionDemandId,1,contextDigest],
    );
    await client.query(
      "insert into recurring_candidates(id,relationship_id,prior_fee_lock_id,offer_id,offer_version,demand_id,demand_version,status,created_at,match_id,updated_at) values($1,$2,$3,$4,$5,$6,$7,'ECONOMICS_PENDING',now(),$8,now())",
      [
        id,
        prior.protected_relationship_id,
        prior.fee_lock_id,
        pair.id,
        pair.version,
        authorization.demand_id,
        authorization.demand_version,
        matchId,
      ],
    );
    await client.query("update recurring_candidates set execution_demand_id=$2,execution_demand_version=1 where id=$1",[id,executionDemandId]);
    await client.query(
      "insert into standing_renewal_reservations(id,demand_id,demand_version,candidate_id,cycle_number,state,reserved_at,expires_at) values($1,$2,$3,$4,$5,'RESERVED',now(),least($6,now()+interval '14 days'))",
      [reservationId,authorization.demand_id,authorization.demand_version,id,cycleNumber,authorization.valid_until],
    );
    await client.query("update recurring_candidates set reservation_id=$2 where id=$1",[id,reservationId]);
    await client.query(
      "update standing_demand_authorizations set renewals_reserved=renewals_reserved+1 where demand_id=$1 and demand_version=$2",
      [authorization.demand_id,authorization.demand_version],
    );
    await client.query(
      "insert into cost_components(id,match_id,cost_kind,amount_per_kg,currency,evidence,source_receipt_id,valid_until,basis,payer_role,settlement_treatment,beneficiary_role) values(gen_random_uuid(),$1,'SUPPLIER_NET',$2,$3,'FIRM',$4,$5,'current recurring supplier net','BUYER','SUPPLIER_ENTITLEMENT','SUPPLIER')",
      [matchId,pair.supplier_net,pair.currency,pair.source_event_id,pair.expires_at],
    );
    await client.query(
      "insert into economic_quote_jobs(id,match_id,cost_kind,state) select gen_random_uuid(),$1,k.kind,'PENDING' from(values('FREIGHT'),('INSPECTION'),('PAYMENT_RAIL'),('TAX_CHARGE'),('RISK_RESERVE'))k(kind)",
      [matchId],
    );
    await client.query(
      "update trades set state='RECURRING',updated_at=now() where id=$1 and state='SETTLED'",
      [tradeId],
    );
    return accepted(`recurring:${id}`, {
      candidateId: id,
      matchId,
      reservationId,
      status: "ECONOMICS_PENDING",
    });
  });
}
async function runDiscovery(
  service: ProductionDiscoveryService | undefined,
  sourceId: string,
  role: "SUPPLIER" | "BUYER",
): Promise<StageResult> {
  if (!service) return unknown("production discovery service unavailable");
  try {
    const result = await service.run(sourceId, role);
    return result.receiptIds.length
      ? accepted(result.receiptIds[0]!, {
          sourceId,
          role,
          candidateCount: result.candidateCount,
          receiptIds: result.receiptIds,
          stoppedReason: result.stoppedReason,
        })
      : unknown("discovery returned no source receipt");
  } catch (error) {
    return rejected(`source:${sourceId}`, (error as Error).message);
  }
}
async function activateEconomicJobsForSweep(
  pool: Pool,
  anchorType: "OFFER" | "DEMAND",
  anchorId: string,
  anchorVersion: number,
) {
  await inTransaction(pool, async (client) => {
    const anchorPredicate =
      anchorType === "OFFER"
        ? "m.offer_id=$1 and m.offer_version=$2"
        : "m.demand_id=$1 and m.demand_version=$2";
    await client.query(
      `insert into cost_components(id,match_id,cost_kind,amount_per_kg,currency,evidence,source_receipt_id,valid_until,basis,payer_role,settlement_treatment,beneficiary_role) select gen_random_uuid(),m.id,'SUPPLIER_NET',o.supplier_net,o.currency,'FIRM',o.source_event_id,o.expires_at,'supplier source-stated net verified through qualification','BUYER','SUPPLIER_ENTITLEMENT','SUPPLIER' from matches m join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version where ${anchorPredicate} and m.compatible on conflict(match_id,cost_kind) do nothing`,
      [anchorId, anchorVersion],
    );
    await client.query(
      `insert into economic_quote_jobs(id,match_id,cost_kind,state) select gen_random_uuid(),m.id,k.kind,'PENDING' from matches m join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version cross join(values('FREIGHT'),('INSPECTION'),('PAYMENT_RAIL'),('TAX_CHARGE'),('RISK_RESERVE'))k(kind) where ${anchorPredicate} and m.compatible and d.ceiling_state='KNOWN' and m.priority_score>0 on conflict(match_id,cost_kind) do nothing`,
      [anchorId, anchorVersion],
    );
  });
}
const ensureEconomicJobs = activateEconomicJobsForSweep;
async function executableCounterparts(
  pool: Pool,
  table: "supplier_offers" | "buyer_demands",
  anchor: QueryResultRow,
  now: string,
  cursorCreatedAt: Date | string | null,
  cursorId: string | null,
  limit: number,
) {
  const verification = "verification='VERIFIED'",
    freshness = "freshness='CURRENT'";
  return table === "supplier_offers"
    ? pool.query(
        `select * from supplier_offers x where ${verification} and ${freshness} and expires_at>$1 and version=(select max(version) from supplier_offers y where y.id=x.id) and product_family=$2 and quantity_mt>=$3 and moq_mt<=$3 and ($4::timestamptz is null or (created_at,id)>($4::timestamptz,$5::uuid)) order by created_at,id limit $6`,
        [now, anchor.product_family, anchor.quantity_mt, cursorCreatedAt, cursorId, limit],
      )
    : pool.query(
        `select * from buyer_demands x where ${verification} and ${freshness} and expires_at>$1 and version=(select max(version) from buyer_demands y where y.id=x.id) and product_family=$2 and quantity_mt<=$3 and quantity_mt>=$4 and ($5::timestamptz is null or (created_at,id)>($5::timestamptz,$6::uuid)) order by created_at,id limit $7`,
        [now, anchor.product_family, anchor.quantity_mt, anchor.moq_mt, cursorCreatedAt, cursorId, limit],
      );
}
async function matchGates(
  pool: Pool,
  offer: QueryResultRow,
  demand: QueryResultRow,
  now: string,
) {
  const reasons: string[] = [];
  for (const [type, id, version] of [
    ["SUPPLIER_OFFER", offer.id, offer.version],
    ["BUYER_DEMAND", demand.id, demand.version],
  ]) {
    const q = (
      await pool.query(
        "select verdict,id from qualification_decisions where subject_type=$1 and subject_id=$2 and subject_version=$3 order by decided_at desc limit 1",
        [type, id, version],
      )
    ).rows[0];
    if (q?.verdict !== "PASS") reasons.push(`${type}_NOT_QUALIFIED`);
  }
  for (const organizationId of [offer.supplier_id, demand.buyer_id]) {
    const risk = (
      await pool.query(
        "select state,id from risk_decisions where organization_id=$1 order by decided_at desc limit 1",
        [organizationId],
      )
    ).rows[0];
    if (risk?.state !== "PASS") reasons.push("RISK_GATE_FAILED");
  }
  const route = (
    await pool.query(
      "with route_facts as(select case when sj.country_code='IN' and bj.country_code='IN' then 'DOMESTIC_INDIA' else 'INTERNATIONAL' end geography,exists(select 1 from trades t where t.supplier_id=$1 and t.buyer_id=$2 and t.state in('SETTLED','RECURRING')) established,exists(select 1 from protected_relationships pr join documentary_lc_route_evidence l on l.relationship_id=pr.id and l.valid_until>$3 join document_checks dc on dc.id=l.document_check_id and dc.check_type='DOCUMENTARY_LC_AUTHENTICITY' and dc.state='VERIFIED' and (dc.valid_until is null or dc.valid_until>$3) where pr.supplier_id=$1 and pr.buyer_id=$2 and pr.protected_until>$3) has_lc from organization_jurisdictions sj join organization_jurisdictions bj on bj.organization_id=$2 and bj.state='VERIFIED' and bj.valid_until>$3 where sj.organization_id=$1 and sj.state='VERIFIED' and sj.valid_until>$3), allowed as(select geography,case when geography='DOMESTIC_INDIA' then array['CASHFREE_EASY_SPLIT','INDIAN_BANK_ESCROW','RAZORPAY_ROUTE']::text[] when established and has_lc then array['LC_PROCEEDS','ESCROW_COM']::text[] else array['ESCROW_COM']::text[] end providers from route_facts) select s.id,s.provider,a.geography from allowed a join lateral(select pcs.id,pcs.provider from provider_capability_snapshots pcs join provider_approvals pa on pa.id=pcs.approval_id and pa.provider=pcs.provider and pa.environment='PRODUCTION' and pa.state='APPROVED' and pa.valid_from<=$3 and pa.valid_until>$3 and pa.currencies ? $4 and pa.commodity_families ? $5 join authority_receipts ar on ar.receipt_id=pa.written_approval_receipt_id and ar.authority_kind='PROVIDER_WRITTEN_APPROVAL' and ar.retrieved_at<=$3 and ar.effective_at<=$3 and ar.expires_at>$3 where pcs.environment='PRODUCTION' and pcs.state='AVAILABLE' and pcs.provider=any(a.providers) and pcs.capabilities ? 'BROKER_FEE_SPLIT' and pcs.evaluated_at<=$3 order by pcs.evaluated_at desc limit 1)s on true",
      [
        offer.supplier_id,
        demand.buyer_id,
        now,
        String(demand.currency ?? offer.currency),
        offer.product_family,
      ],
    )
  ).rows[0];
  if (!route) reasons.push("ROUTE_SPECIFIC_SETTLEMENT_UNAVAILABLE");
  return { reasons, providerSnapshotId: route?.id ?? null, geography: route?.geography ?? null };
}

async function preQuotePriority(pool: Pool, offer: QueryResultRow, demand: QueryResultRow, geography: string | null, now: string): Promise<string> {
  if (!geography || demand.ceiling_state !== "KNOWN" || demand.buyer_ceiling === null) return "0";
  const policy = (await pool.query(
    "select p.commission_floor_per_kg,p.surplus_capture_rate,p.hard_commission_cap_per_kg from pricing_policies p join authority_receipts a on a.receipt_id=p.approval_receipt_id and a.authority_kind='PRICING_POLICY_APPROVAL' and a.retrieved_at<=$2 and a.effective_at<=$2 and a.expires_at>$2 where p.currency=$1 and p.valid_from<=$2 and p.valid_until>$2 order by p.valid_from desc limit 1",
    [String(demand.currency ?? offer.currency), now],
  )).rows[0];
  if (!policy) return "0";
  const offerSpec=(offer.product_spec??{}) as Record<string,unknown>,demandSpec=(demand.product_spec??{}) as Record<string,unknown>,
    costPrior=(await pool.query(
      "with lane as(select sum(c.amount_per_kg) external_cost from matches m join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version join trades t on t.match_id=m.id and t.state in('SETTLED','RECURRING') join cost_components c on c.match_id=m.id and c.cost_kind<>'SUPPLIER_NET' where o.product_family=$1 and t.geography=$2 and coalesce(o.product_spec->>'incoterm','UNKNOWN')=$3 and coalesce(d.product_spec->>'application',o.product_spec->>'application','UNKNOWN')=$4 group by m.id),broad as(select sum(c.amount_per_kg) external_cost from matches m join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join trades t on t.match_id=m.id and t.state in('SETTLED','RECURRING') join cost_components c on c.match_id=m.id and c.cost_kind<>'SUPPLIER_NET' where t.geography=$2 group by m.id) select coalesce((select percentile_cont(.75) within group(order by external_cost) from lane),(select percentile_cont(.75) within group(order by external_cost) from broad),0)::text p75",
      [offer.product_family,geography,String(offerSpec.incoterm??"UNKNOWN"),String(demandSpec.application??offerSpec.application??"UNKNOWN")],
    )).rows[0],
    grossSpread=subtractDecimal(decimal(String(demand.buyer_ceiling)),decimal(String(offer.supplier_net))),
    spread=subtractDecimal(grossSpread,decimal(String(costPrior?.p75??"0")));
  if(compareDecimalStrings(spread,decimal("0"))<=0)return "0";
  let commission=minDecimal(decimal(String(policy.hard_commission_cap_per_kg)),maxDecimal(decimal(String(policy.commission_floor_per_kg)),multiplyDecimal(decimal(String(policy.surplus_capture_rate)),spread)));
  commission=minDecimal(commission,spread);
  const segment = (await pool.query(
    "with p as(select segment_id from acquisition_profiles where organization_id=$1 and target_product_family=$2 and classification_state in('SOURCE_STATED','VERIFIED') and valid_until>$3 order by created_at desc limit 1),counts as(select count(distinct subject_id) filter(where event_type='QUALIFIED') qualified,count(distinct subject_id) filter(where event_type='FUNDED') funded,count(distinct subject_id) filter(where event_type='SETTLED') settled from acquisition_funnel_observations where segment_id=(select segment_id from p)) select qualified,funded,settled from counts",
    [demand.buyer_id, offer.product_family, now],
  )).rows[0] ?? { qualified: 0, funded: 0, settled: 0 };
  const authorization = demand.standing ? (await pool.query(
    "select greatest(least(maximum_renewals-renewals_consumed-renewals_reserved,greatest(floor(extract(epoch from(valid_until-greatest(next_required_at,$3::timestamptz)))/(86400*cadence_days))+1,0)),0)::text remaining_orders from standing_demand_authorizations where demand_id=$1 and demand_version=$2 and automatic_renewal_permitted and valid_until>$3",
    [demand.id,demand.version,now],
  )).rows[0] : null;
  const qualified = Number(segment.qualified), funded = Number(segment.funded), settled = Number(segment.settled),
    close = divideDecimal(decimal(String(funded + 5)), decimal(String(qualified + 20)), 8),
    settleGivenFunded = divideDecimal(decimal(String(settled + 7)), decimal(String(funded + 10)), 8),
    result = expectedProfitPriority({
      monthlyVolumeKg: known(multiplyDecimal(decimal(String(demand.quantity_mt)), decimal("1000")), "prequote:volume"),
      expectedCommissionPerKg: known(commission, "prequote:spread-policy"),
      expectedMonths: known(decimal(String(authorization?.remaining_orders ?? (demand.standing ? "0" : "1"))), "prequote:authorized-remaining-orders"),
      physicalFillRatio: known(decimal("0.8"), "prequote:physical-prior"),
      closeProbability: known(close, "prequote:segment-close"),
      settlementGivenFundedProbability: known(settleGivenFunded, "prequote:segment-settlement"),
      operationalComplexity: known(decimal(geography === "INTERNATIONAL" ? "1.5" : "1"), "prequote:verified-jurisdictions"),
      expectedDaysToCash: known(decimal(geography === "INTERNATIONAL" ? "45" : "30"), "prequote:route-days"),
    }, qualified > 0 ? "CALIBRATED" : "HEURISTIC");
  return result.state === "KNOWN" ? result.value : "0";
}
export function deepCompatible(offer: unknown, demand: unknown) {
  if (
    !offer ||
    !demand ||
    typeof offer !== "object" ||
    typeof demand !== "object"
  )
    return false;
  const supplied = offer as Record<string, unknown>,
    required = demand as Record<string, unknown>,
    offerMin = safeSpecDecimal(supplied.mfiMin),
    offerMax = safeSpecDecimal(supplied.mfiMax),
    demandMin = safeSpecDecimal(required.mfiMin),
    demandMax = safeSpecDecimal(required.mfiMax);
  if (
    [
      [supplied.mfiMin, offerMin],
      [supplied.mfiMax, offerMax],
      [required.mfiMin, demandMin],
      [required.mfiMax, demandMax],
    ].some(([raw, parsed]) => raw !== undefined && raw !== null && !parsed)
  )
    return false;
  if ((demandMin || demandMax) && (!offerMin || !offerMax)) return false;
  if (demandMin && offerMin && compareDecimalStrings(offerMin, demandMin) < 0)
    return false;
  if (demandMax && offerMax && compareDecimalStrings(offerMax, demandMax) > 0)
    return false;
  for (const field of [
    "application",
    "colour",
    "grade",
    "recycledContentType",
  ]) {
    const expected = required[field];
    if (
      expected !== undefined &&
      expected !== null &&
      String(expected).trim() &&
      String(supplied[field] ?? "")
        .trim()
        .toLowerCase() !== String(expected).trim().toLowerCase()
    )
      return false;
  }
  for (const field of ["density", "ash", "moisture"]) {
    const expected = safeSpecDecimal(required[field]);
    if (required[field] !== undefined && required[field] !== null && !expected)
      return false;
    if (!expected) continue;
    const actual = safeSpecDecimal(supplied[field]);
    if (!actual) return false;
    if (
      field === "density"
        ? compareDecimalStrings(actual, expected) !== 0
        : compareDecimalStrings(actual, expected) > 0
    )
      return false;
  }
  const properties = Array.isArray(required.properties)
      ? required.properties
      : [],
    offered = Array.isArray(supplied.properties) ? supplied.properties : [];
  return properties.every((value) =>
    offered.some(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(value),
    ),
  );
}
function safeSpecDecimal(value: unknown) {
  if (value === undefined || value === null) return null;
  try {
    return typeof value === "string" || typeof value === "number"
      ? decimal(String(value))
      : null;
  } catch {
    return null;
  }
}
async function latestDecision(
  pool: Pool,
  table: string,
  key: string,
  value: string,
  order: string,
  prefix: string,
): Promise<StageResult> {
  const row = (
    await pool.query(
      `select * from ${table} where ${key}=$1 order by ${order} desc limit 1`,
      [value],
    )
  ).rows[0];
  if (!row) return unknown(`${prefix} decision missing`);
  const action = String(row.action ?? row.state ?? "");
  return ["ACCEPT", "ACCEPTED", "PASS"].includes(action)
    ? accepted(receipt(row, prefix), { action })
    : ["DECLINE", "REJECT", "REJECTED"].includes(action)
      ? rejected(receipt(row, prefix), action)
      : unknown(`${prefix} not terminal`);
}

async function protectMatch(pool: Pool, matchId: string): Promise<StageResult> {
  return inTransaction(pool, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `protect:${matchId}`,
    ]);
    let relationship = (
      await client.query(
        "select pr.* from protected_relationships pr join matches m on m.offer_id in(select id from supplier_offers where supplier_id=pr.supplier_id) and m.demand_id in(select id from buyer_demands where buyer_id=pr.buyer_id) where m.id=$1 and pr.status='PROTECTED' and pr.protected_until>now() order by pr.introduced_at desc limit 1 for update",
        [matchId],
      )
    ).rows[0];
    if (!relationship)
      relationship = (
        await client.query(
          "with facts as (select m.id match_id,o.supplier_id,d.buyer_id,o.product_family,fe.id final_economics_snapshot_id,fe.realized_commission_per_kg,fe.currency,fe.third_party_allocations,fe.provider_deductions,fe.reserve_allocations,sa.agreement_acceptance_id supplier_acceptance_id,ba.agreement_acceptance_id buyer_acceptance_id,p.protection_months,p.affiliate_scope,p.qualifying_purchase_definition from matches m join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version join final_economics_snapshots fe on fe.match_id=m.id join negotiations n on n.id=fe.negotiation_id and n.status='ACCEPTED' join protected_match_acceptances sa on sa.match_id=m.id and sa.role='SUPPLIER' join protected_match_acceptances ba on ba.match_id=m.id and ba.role='BUYER' join lateral(select * from protected_relationship_policies where effective_at<=now() and expires_at>now() order by effective_at desc limit 1)p on true where m.id=$1 and m.compatible),capabilities as(select *,jsonb_build_array('BROKER_FEE_SPLIT')||case when jsonb_array_length(third_party_allocations)>0 then jsonb_build_array('MULTI_BENEFICIARY') else '[]'::jsonb end||case when jsonb_array_length(provider_deductions)>0 then jsonb_build_array('PROVIDER_DEDUCTION') else '[]'::jsonb end||case when jsonb_array_length(reserve_allocations)>0 then jsonb_build_array('RESERVE_HOLD') else '[]'::jsonb end required from facts) insert into protected_relationships(id,supplier_id,buyer_id,introduced_at,protected_until,commodity_scope,affiliate_scope,qualifying_purchase_definition,commission_type,commission_rate,currency,supplier_acceptance_id,buyer_acceptance_id,required_settlement_capabilities,status,final_economics_snapshot_id) select gen_random_uuid(),supplier_id,buyer_id,now(),now()+(protection_months||' months')::interval,jsonb_build_array(product_family),affiliate_scope,qualifying_purchase_definition,'PER_KG',realized_commission_per_kg,currency,supplier_acceptance_id,buyer_acceptance_id,required,'PROTECTED',final_economics_snapshot_id from capabilities returning *",
          [matchId],
        )
      ).rows[0];
    if (!relationship)
      return unknown("protected relationship prerequisites incomplete");
    let trade = (
      await client.query(
        "select * from trades where match_id=$1 and relationship_id=$2 order by updated_at desc limit 1 for update",
        [matchId, relationship.id],
      )
    ).rows[0];
    if (!trade) {
      const tradeId = randomUUID(),
        facts = (
          await client.query(
            "select o.supplier_id,d.buyer_id,case when sj.country_code='IN' and bj.country_code='IN' then 'DOMESTIC_INDIA' else 'INTERNATIONAL' end geography,case when exists(select 1 from trades prior where prior.supplier_id=o.supplier_id and prior.buyer_id=d.buyer_id and prior.state in('SETTLED','RECURRING')) then 'ESTABLISHED' else 'NEW' end relationship_maturity,exists(select 1 from documentary_lc_route_evidence l join documents doc on doc.id=l.document_id and doc.kind='DOCUMENTARY_LC' join document_checks dc on dc.id=l.document_check_id and dc.document_id=doc.id and dc.check_type='DOCUMENTARY_LC_AUTHENTICITY' and dc.state='VERIFIED' and (dc.valid_until is null or dc.valid_until>now()) where l.relationship_id=$2 and l.valid_until>now()) has_documentary_lc from matches m join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version join organization_jurisdictions sj on sj.organization_id=o.supplier_id and sj.state='VERIFIED' and sj.valid_until>now() join organization_jurisdictions bj on bj.organization_id=d.buyer_id and bj.state='VERIFIED' and bj.valid_until>now() where m.id=$1",
            [matchId, relationship.id],
          )
        ).rows[0];
      if (!facts)
        return unknown("verified counterparty jurisdictions unavailable");
      trade = (
        await client.query(
          "insert into trades(id,match_id,supplier_id,buyer_id,relationship_id,state,geography,relationship_maturity,has_documentary_lc) values($1,$2,$3,$4,$5,'PROTECTED',$6,$7,$8) returning *",
          [
            tradeId,
            matchId,
            facts.supplier_id,
            facts.buyer_id,
            relationship.id,
            facts.geography,
            facts.relationship_maturity,
            facts.has_documentary_lc,
          ],
        )
      ).rows[0];
      const outbox = new TransactionalOutboxRepository(pool);
      await outbox.append(client, {
        id: randomUUID(),
        aggregateType: "TRADE",
        aggregateId: tradeId,
        eventType: "TRADE_PROTECTED",
        payload: { tradeId, matchId, relationshipId: relationship.id },
        idempotencyKey: `trade:${tradeId}:protected`,
      });
    }
    return accepted(receipt(relationship, "relationship"), {
      relationshipId: relationship.id,
      tradeId: trade.id,
    });
  });
}

async function lockSettlement(
  pool: Pool,
  adapters: readonly SettlementAdapter[],
  tradeId: string,
  requestedProvider: string,
  providerParties?: ProviderPartyReferenceResolver,
): Promise<StageResult> {
  const existing = (
    await pool.query(
      "select * from fee_locks where trade_id=$1 and state='LOCKED' order by created_at desc limit 1",
      [tradeId],
    )
  ).rows[0];
  if (existing)
    return accepted(receipt(existing, "fee-lock"), {
      feeLockId: existing.id,
      provider: existing.provider,
    });
  const facts = (
    await pool.query(
      "select t.*,pr.id relationship_id,pr.commission_rate,pr.currency relationship_currency,m.offer_id,m.offer_version,m.demand_id,m.demand_version,o.product_family,d.quantity_mt,fe.id final_economics_snapshot_id,fe.accepted_buyer_price_per_kg,fe.realized_commission_per_kg,fe.settlement_supplier_per_kg,fe.settlement_gross_per_kg,fe.third_party_allocations,fe.provider_deductions,fe.reserve_allocations,fe.buyer_direct_costs,fe.waterfall_digest from trades t join protected_relationships pr on pr.id=t.relationship_id join final_economics_snapshots fe on fe.id=pr.final_economics_snapshot_id and fe.match_id=t.match_id join matches m on m.id=t.match_id join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version where t.id=$1 and t.state in('PROTECTED','FEE_LOCKED') and pr.protected_until>now()",
      [tradeId],
    )
  ).rows[0];
  if (!facts) return unknown("protected trade economics missing");
  if (
    (Array.isArray(facts.third_party_allocations) && facts.third_party_allocations.length) ||
    (Array.isArray(facts.reserve_allocations) && facts.reserve_allocations.length) ||
    (Array.isArray(facts.provider_deductions) && facts.provider_deductions.length)
  )
    return unknown("exact multi-beneficiary or provider-deduction rail unavailable");
  let instruction = (
    await pool.query(
      "select * from settlement_instructions where trade_id=$1 and expires_at>now() order by created_at desc limit 1",
      [tradeId],
    )
  ).rows[0];
  let routed;
  if (!instruction) {
    try {
      routed = routeSettlement(
        {
          geography: facts.geography,
          relationshipMaturity: facts.relationship_maturity,
          hasDocumentaryLc: facts.has_documentary_lc,
        },
        requestedProvider === "AUTO_ROUTE"
          ? adapters
          : adapters.filter(
              (adapter) => adapter.provider === requestedProvider,
            ),
        ["BROKER_FEE_SPLIT"],
        new Date().toISOString(),
      );
    } catch {
      return unknown("approved production settlement rail missing");
    }
    const kg = multiplyDecimal(
        decimal(String(facts.quantity_mt)),
        decimal("1000"),
      ),
      supplierEntitlement = multiplyDecimal(
        decimal(String(facts.settlement_supplier_per_kg)),
        kg,
      ),
      sablestoneEntitlement = multiplyDecimal(
        decimal(String(facts.realized_commission_per_kg)),
        kg,
      ),
      gross = multiplyDecimal(
        decimal(String(facts.settlement_gross_per_kg)),
        kg,
      ),
      buyerAllIn = multiplyDecimal(
        decimal(String(facts.accepted_buyer_price_per_kg)),
        kg,
      ),
      buyerDirectCosts = scaleWaterfallAllocations(
        facts.buyer_direct_costs,
        kg,
      ),
      id = randomUUID(),
      expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
    await pool.query(
      "insert into settlement_instructions(id,trade_id,provider,environment,commodity_family,buyer_id,supplier_id,sablestone_beneficiary_id,currency,gross_amount,supplier_entitlement,sablestone_entitlement,other_allocations,release_conditions,dispute_procedure,expires_at,idempotency_key,final_economics_snapshot_id,buyer_all_in_amount,buyer_direct_costs,provider_deductions,waterfall_digest) select $1,$2,$3,'PRODUCTION',$4,t.buyer_id,t.supplier_id,o.id,$5,$6,$7,$8,'[]'::jsonb,'[\"DELIVERY_ACCEPTED\"]'::jsonb,'PROVIDER_OR_BANK_FREEZE',$9,$10,$11,$12,$13,'[]'::jsonb,$14 from trades t cross join lateral(select id from organizations where organization_type='SABLESTONE' order by created_at limit 1)o where t.id=$2",
      [
        id,
        tradeId,
        facts.product_family,
        facts.relationship_currency,
        gross,
        supplierEntitlement,
        sablestoneEntitlement,
        expiresAt,
        `settlement:${tradeId}`,
        facts.final_economics_snapshot_id,
        buyerAllIn,
        JSON.stringify(buyerDirectCosts),
        facts.waterfall_digest,
      ],
    );
    instruction = (
      await pool.query("select * from settlement_instructions where id=$1", [
        id,
      ])
    ).rows[0];
  }
  if (!instruction)
    return unknown("settlement beneficiary organization missing");
  const digest = settlementInstructionAcceptanceDigest(instruction),
    acceptances = (
      await pool.query(
        "select role,instruction_digest from settlement_instruction_acceptances where instruction_id=$1",
        [instruction.id],
      )
    ).rows;
  if (
    acceptances.length !== 2 ||
    acceptances.some((row) => row.instruction_digest !== digest)
  )
    return unknown(
      `settlement instruction awaiting exact acceptances:${instruction.id}:${digest}`,
    );
  if (!routed) {
    try {
      routed = routeSettlement(
        {
          geography: facts.geography,
          relationshipMaturity: facts.relationship_maturity,
          hasDocumentaryLc: facts.has_documentary_lc,
        },
        adapters.filter((adapter) => adapter.provider === instruction.provider),
        ["BROKER_FEE_SPLIT"],
        new Date().toISOString(),
      );
    } catch {
      return unknown("settlement provider capability no longer available");
    }
  }
  const draft: SettlementInstructionDraft = {
      instructionId: instruction.id,
      tradeId,
      provider: instruction.provider,
      environment: "PRODUCTION",
      commodityFamily: instruction.commodity_family,
      buyerId: instruction.buyer_id,
      supplierId: instruction.supplier_id,
      sablestoneBeneficiaryId: instruction.sablestone_beneficiary_id,
      providerParties: providerParties
        ? await providerParties.resolveAndBind(
            instruction,
            new Date().toISOString(),
          )
        : (() => {
            throw new Error("provider party resolver unavailable");
          })(),
      currency: instruction.currency,
      grossAmount: decimal(String(instruction.gross_amount)),
      buyerAllInAmount: decimal(String(instruction.buyer_all_in_amount)),
      buyerDirectCosts: instruction.buyer_direct_costs,
      providerDeductions: instruction.provider_deductions,
      supplierEntitlement: decimal(String(instruction.supplier_entitlement)),
      sablestoneEntitlement: decimal(
        String(instruction.sablestone_entitlement),
      ),
      otherAllocations: [],
      releaseConditions: instruction.release_conditions,
      disputeProcedure: instruction.dispute_procedure,
      expiresAt: new Date(instruction.expires_at).toISOString(),
      idempotencyKey: instruction.idempotency_key,
    },
    created = instruction.acknowledged
      ? null
      : await routed.adapter.createInstruction(draft, new Date().toISOString());
  if (created)
    await inTransaction(pool, async (client: PoolClient) => {
      const acknowledged = await client.query(
        "update settlement_instructions set provider_reference=$2,provider_approval_id=$3,acknowledged=true where id=$1 and acknowledged=false",
        [instruction.id, created.providerReference, routed.snapshot.approvalId],
      );
      if ((acknowledged.rowCount ?? 0) !== 1)
        throw new Error("settlement instruction acknowledgement conflict");
    });
  return unknown(
    `settlement instruction created; awaiting provider-confirmed secured funds and exact SableStone beneficiary:${instruction.id}`,
  );
}

function scaleWaterfallAllocations(input: unknown, kg: ReturnType<typeof decimal>) {
  if (!Array.isArray(input)) throw new Error("waterfall allocation malformed");
  return input.map((value) => {
    if (!value || typeof value !== "object")
      throw new Error("waterfall allocation malformed");
    const row = value as Record<string, unknown>;
    return Object.freeze({
      costKind: String(row.costKind),
      beneficiaryId: row.beneficiaryId ? String(row.beneficiaryId) : null,
      amount: multiplyDecimal(decimal(String(row.amountPerKg)), kg),
      purpose: String(row.purpose),
    });
  });
}
async function releaseIdentity(
  pool: Pool,
  tradeId: string,
  feeLockReceiptId: string,
): Promise<StageResult> {
  const stage = (
      await pool.query(
        "select facts from workflow_stage_receipts where id=$1 and stage='LOCK_SETTLEMENT' and state='ACCEPTED'",
        [feeLockReceiptId],
      )
    ).rows[0],
    feeLockId = stage?.facts?.feeLockId;
  if (!feeLockId) return unknown("bound fee-lock stage receipt missing");
  const existing = (
    await pool.query(
      "select i.* from identity_release_events i join fee_locks f on f.id=i.fee_lock_id where f.trade_id=$1 and f.id=$2",
      [tradeId, feeLockId],
    )
  ).rows[0];
  if (existing)
    return accepted(receipt(existing, "identity-release"), {
      relationshipId: existing.relationship_id,
      feeLockId,
    });
  const facts = (
    await pool.query(
      "select f.*,pr.supplier_id,pr.buyer_id,pr.protected_until,sa.acceptance_sha256 supplier_hash,ba.acceptance_sha256 buyer_hash from fee_locks f join entitlement_security_events e on e.id=f.entitlement_security_event_id and e.instruction_id=f.instruction_id and e.beneficiary_verified and e.funds_secured join protected_relationships pr on pr.id=f.relationship_id join agreement_acceptances sa on sa.id=pr.supplier_acceptance_id join agreement_acceptances ba on ba.id=pr.buyer_acceptance_id where f.id=$1 and f.trade_id=$2 and f.state='LOCKED' and pr.protected_until>now()",
      [feeLockId, tradeId],
    )
  ).rows[0];
  if (!facts)
    return rejected(
      `fee-lock:${feeLockId}`,
      "identity release prerequisites no longer current",
    );
  const authorizationDigest = createHash("sha256")
    .update(
      JSON.stringify({
        tradeId,
        feeLockId,
        supplierAcceptance: facts.supplier_hash,
        buyerAcceptance: facts.buyer_hash,
        instructionDigest: facts.instruction_digest,
      }),
    )
    .digest("hex");
  await inTransaction(pool, async (client: PoolClient) => {
    await client.query(
      "insert into identity_release_events(relationship_id,supplier_id,buyer_id,fee_lock_id,authorization_digest,released_at) values($1,$2,$3,$4,$5,now())",
      [
        facts.relationship_id,
        facts.supplier_id,
        facts.buyer_id,
        feeLockId,
        authorizationDigest,
      ],
    );
    const updated = await client.query(
      "update trades set state='IDENTITY_RELEASED',updated_at=now() where id=$1 and state='FEE_LOCKED'",
      [tradeId],
    );
    if ((updated.rowCount ?? 0) !== 1)
      throw new Error("identity release trade-state conflict");
  });
  return accepted(`identity-release:${facts.relationship_id}`, {
    relationshipId: facts.relationship_id,
    feeLockId,
  });
}
