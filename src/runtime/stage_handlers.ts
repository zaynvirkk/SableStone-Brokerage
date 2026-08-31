import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { StageHandler, StageName, StageResult } from "./activities.js";
import type {
  SettlementAdapter,
  SettlementInstructionDraft,
} from "../settlement.js";
import { routeSettlement } from "../router.js";
import { addDecimal, decimal, multiplyDecimal } from "../money.js";
import { settlementInstructionAcceptanceDigest } from "./commands.js";
import { inTransaction, TransactionalOutboxRepository } from "./database.js";
import type { ProductionDiscoveryService } from "./discovery_service.js";
import { reconcileTradeAccounting } from "./accounting.js";
import { compareDecimalStrings } from "../domain.js";
import { ensureEconomicJobs } from "./economic_jobs.js";
import type { ProviderPartyReferenceResolver } from "./provider_parties.js";

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
        offers =
          String(input.offerId) === "AUTO_SELECT"
            ? await executable(pool, "supplier_offers", "offer", now)
            : await pool.query(
                "select * from supplier_offers where id=$1 order by version desc limit 1",
                [input.offerId],
              ),
        demands =
          String(input.demandId) === "AUTO_SELECT"
            ? await executable(pool, "buyer_demands", "demand", now)
            : await pool.query(
                "select * from buyer_demands where id=$1 order by version desc limit 1",
                [input.demandId],
              );
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
          const contextDigest = createHash("sha256")
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
              "insert into matches(id,offer_id,offer_version,demand_id,demand_version,compatible,rejection_reasons,matcher_version,context_digest,evaluated_at) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,'production-v1',$7,$8) returning id",
              [
                offer.id,
                offer.version,
                demand.id,
                demand.version,
                reasons.length === 0,
                JSON.stringify([...new Set(reasons)]),
                contextDigest,
                now,
              ],
            );
            id = inserted.rows[0].id;
          }
          if (reasons.length === 0) {
            await ensureEconomicJobs(pool, id, offer);
            return accepted(`match:${id}`, {
              matchId: id,
              offerId: offer.id,
              demandId: demand.id,
            });
          }
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
      if (!row) return unknown("negotiation decision missing");
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
    const prior = (
      await client.query(
        "select t.*,f.id fee_lock_id,pr.id protected_relationship_id,m.demand_id,m.demand_version from trades t join fee_locks f on f.trade_id=t.id join protected_relationships pr on pr.id=f.relationship_id join matches m on m.id=t.match_id where t.id=$1 and t.state in('SETTLED','RECURRING') and pr.protected_until>now()",
        [tradeId],
      )
    ).rows[0];
    if (!prior) return unknown("settled protected relationship missing");
    const authorization = (
      await client.query(
        "select * from standing_demand_authorizations where demand_id=$1 and demand_version=$2 and automatic_renewal_permitted and renewals_used<maximum_renewals and valid_until>now() for update",
        [prior.demand_id, prior.demand_version],
      )
    ).rows[0];
    if (!authorization)
      return unknown("standing demand authorization unavailable");
    const existing = (
      await client.query(
        "select * from recurring_candidates where prior_fee_lock_id=$1 order by created_at desc limit 1",
        [prior.fee_lock_id],
      )
    ).rows[0];
    if (existing)
      return accepted(receipt(existing, "recurring"), {
        candidateId: existing.id,
        status: existing.status,
      });
    const pair = (
      await client.query(
        "select m.offer_id,m.offer_version,m.demand_id,m.demand_version from matches m join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version where m.compatible and m.matcher_version='production-v1' and d.id=$1 and d.version=$2 and o.supplier_id=$3 and d.buyer_id=$4 and o.verification='VERIFIED' and o.freshness='CURRENT' and o.expires_at>now() and d.verification='VERIFIED' and d.freshness='CURRENT' and d.expires_at>now() and exists(select 1 from qualification_decisions q where q.subject_type='SUPPLIER_OFFER' and q.subject_id=o.id and q.subject_version=o.version and q.verdict='PASS') and exists(select 1 from qualification_decisions q where q.subject_type='BUYER_DEMAND' and q.subject_id=d.id and q.subject_version=d.version and q.verdict='PASS') and exists(select 1 from risk_decisions r where r.organization_id=o.supplier_id and r.state='PASS') and exists(select 1 from risk_decisions r where r.organization_id=d.buyer_id and r.state='PASS') order by m.evaluated_at desc limit 1",
        [
          prior.demand_id,
          prior.demand_version,
          prior.supplier_id,
          prior.buyer_id,
        ],
      )
    ).rows[0];
    if (!pair)
      return unknown("no current fully-qualified compatible recurring match");
    const id = randomUUID();
    await client.query(
      "insert into recurring_candidates(id,relationship_id,prior_fee_lock_id,offer_id,offer_version,demand_id,demand_version,status,created_at) values($1,$2,$3,$4,$5,$6,$7,'MATCHED_REQUIRES_NEW_FEE_LOCK',now())",
      [
        id,
        prior.protected_relationship_id,
        prior.fee_lock_id,
        pair.offer_id,
        pair.offer_version,
        pair.demand_id,
        pair.demand_version,
      ],
    );
    await client.query(
      "update standing_demand_authorizations set renewals_used=renewals_used+1 where demand_id=$1 and demand_version=$2",
      [prior.demand_id, prior.demand_version],
    );
    await client.query(
      "update trades set state='RECURRING',updated_at=now() where id=$1 and state='SETTLED'",
      [tradeId],
    );
    return accepted(`recurring:${id}`, {
      candidateId: id,
      status: "MATCHED_REQUIRES_NEW_FEE_LOCK",
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
async function createRecurringMatch(
  pool: Pool,
  tradeId: string,
): Promise<StageResult> {
  return inTransaction(pool, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `recurring:${tradeId}`,
    ]);
    const prior = (
      await client.query(
        "select t.*,f.id fee_lock_id,pr.id protected_relationship_id,m.offer_id,m.offer_version,m.demand_id,m.demand_version,o.product_family from trades t join fee_locks f on f.trade_id=t.id join protected_relationships pr on pr.id=f.relationship_id join matches m on m.id=t.match_id join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version where t.id=$1 and t.state in('SETTLED','RECURRING') and pr.protected_until>now()",
        [tradeId],
      )
    ).rows[0];
    if (!prior) return unknown("settled protected relationship missing");
    const authorization = (
      await client.query(
        "select * from standing_demand_authorizations where demand_id=$1 and demand_version=$2 and automatic_renewal_permitted and renewals_used<maximum_renewals and valid_until>now() for update",
        [prior.demand_id, prior.demand_version],
      )
    ).rows[0];
    if (!authorization)
      return unknown("standing demand authorization unavailable");
    const existing = (
      await client.query(
        "select * from recurring_candidates where prior_fee_lock_id=$1 order by created_at desc limit 1",
        [prior.fee_lock_id],
      )
    ).rows[0];
    if (existing)
      return accepted(receipt(existing, "recurring"), {
        candidateId: existing.id,
        status: existing.status,
      });
    const pair = (
      await client.query(
        "select o.id offer_id,o.version offer_version,d.id demand_id,d.version demand_version from supplier_offers o join buyer_demands d on d.id=$1 and d.version=$2 where o.supplier_id=$3 and d.buyer_id=$4 and o.product_family=d.product_family and o.verification='VERIFIED' and o.freshness='CURRENT' and o.expires_at>now() and d.verification='VERIFIED' and d.freshness='CURRENT' and d.expires_at>now() and o.quantity_mt>=d.quantity_mt and d.quantity_mt>=o.moq_mt order by o.created_at desc limit 1",
        [
          prior.demand_id,
          prior.demand_version,
          prior.supplier_id,
          prior.buyer_id,
        ],
      )
    ).rows[0];
    if (!pair) return unknown("no fresh recurring supply match");
    const id = randomUUID();
    await client.query(
      "insert into recurring_candidates(id,relationship_id,prior_fee_lock_id,offer_id,offer_version,demand_id,demand_version,status,created_at) values($1,$2,$3,$4,$5,$6,$7,'MATCHED_REQUIRES_NEW_FEE_LOCK',now())",
      [
        id,
        prior.protected_relationship_id,
        prior.fee_lock_id,
        pair.offer_id,
        pair.offer_version,
        pair.demand_id,
        pair.demand_version,
      ],
    );
    await client.query(
      "update standing_demand_authorizations set renewals_used=renewals_used+1 where demand_id=$1 and demand_version=$2",
      [prior.demand_id, prior.demand_version],
    );
    await client.query(
      "update trades set state='RECURRING',updated_at=now() where id=$1 and state='SETTLED'",
      [tradeId],
    );
    return accepted(`recurring:${id}`, {
      candidateId: id,
      status: "MATCHED_REQUIRES_NEW_FEE_LOCK",
    });
  });
}
async function executable(
  pool: Pool,
  table: "supplier_offers" | "buyer_demands",
  kind: "offer" | "demand",
  now: string,
) {
  const verification = "verification='VERIFIED'",
    freshness = "freshness='CURRENT'";
  return pool.query(
    `select * from ${table} x where ${verification} and ${freshness} and expires_at>$1 and version=(select max(version) from ${table} y where y.id=x.id) order by created_at limit 100`,
    [now],
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
  const provider = (
    await pool.query(
      "select state,id from provider_capability_snapshots where environment='PRODUCTION' and evaluated_at<=$1 order by evaluated_at desc limit 1",
      [now],
    )
  ).rows[0];
  if (provider?.state !== "AVAILABLE") reasons.push("SETTLEMENT_UNAVAILABLE");
  return { reasons, providerSnapshotId: provider?.id ?? null };
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
          "with facts as (select m.id match_id,o.supplier_id,d.buyer_id,o.product_family,pd.commission_per_kg,pd.currency,sa.agreement_acceptance_id supplier_acceptance_id,ba.agreement_acceptance_id buyer_acceptance_id,p.protection_months,p.affiliate_scope,p.qualifying_purchase_definition from matches m join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version join pricing_decisions pd on pd.match_id=m.id and pd.state='EXECUTABLE' join protected_match_acceptances sa on sa.match_id=m.id and sa.role='SUPPLIER' join protected_match_acceptances ba on ba.match_id=m.id and ba.role='BUYER' join lateral(select * from protected_relationship_policies where effective_at<=now() and expires_at>now() order by effective_at desc limit 1)p on true where m.id=$1 and m.compatible) insert into protected_relationships(id,supplier_id,buyer_id,introduced_at,protected_until,commodity_scope,affiliate_scope,qualifying_purchase_definition,commission_type,commission_rate,currency,supplier_acceptance_id,buyer_acceptance_id,required_settlement_capabilities,status) select gen_random_uuid(),supplier_id,buyer_id,now(),now()+(protection_months||' months')::interval,jsonb_build_array(product_family),affiliate_scope,qualifying_purchase_definition,'PER_KG',commission_per_kg,currency,supplier_acceptance_id,buyer_acceptance_id,'[\"BROKER_FEE_SPLIT\"]'::jsonb,'PROTECTED' from facts returning *",
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
            "select o.supplier_id,d.buyer_id from matches m join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version where m.id=$1",
            [matchId],
          )
        ).rows[0];
      if (!facts) throw new Error("protected match disappeared");
      trade = (
        await client.query(
          "insert into trades(id,match_id,supplier_id,buyer_id,relationship_id,state,geography,relationship_maturity,has_documentary_lc) values($1,$2,$3,$4,$5,'PROTECTED','DOMESTIC_INDIA','NEW',false) returning *",
          [
            tradeId,
            matchId,
            facts.supplier_id,
            facts.buyer_id,
            relationship.id,
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
      "select t.*,pr.id relationship_id,pr.commission_rate,pr.currency relationship_currency,m.offer_id,m.offer_version,m.demand_id,m.demand_version,o.product_family,o.supplier_net,d.quantity_mt from trades t join protected_relationships pr on pr.id=t.relationship_id join matches m on m.id=t.match_id join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version where t.id=$1 and t.state in('PROTECTED','FEE_LOCKED') and pr.protected_until>now()",
      [tradeId],
    )
  ).rows[0];
  if (!facts) return unknown("protected trade economics missing");
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
        decimal(String(facts.supplier_net)),
        kg,
      ),
      sablestoneEntitlement = multiplyDecimal(
        decimal(String(facts.commission_rate)),
        kg,
      ),
      gross = addDecimal(supplierEntitlement, sablestoneEntitlement),
      id = randomUUID(),
      expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
    await pool.query(
      "insert into settlement_instructions(id,trade_id,provider,environment,commodity_family,buyer_id,supplier_id,sablestone_beneficiary_id,currency,gross_amount,supplier_entitlement,sablestone_entitlement,other_allocations,release_conditions,dispute_procedure,expires_at,idempotency_key) select $1,$2,$3,'PRODUCTION',$4,t.buyer_id,t.supplier_id,o.id,$5,$6,$7,$8,'[]'::jsonb,'[\"DELIVERY_ACCEPTED\"]'::jsonb,'PROVIDER_OR_BANK_FREEZE',$9,$10 from trades t cross join lateral(select id from organizations where organization_type='SABLESTONE' order by created_at limit 1)o where t.id=$2",
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
      "select f.*,pr.supplier_id,pr.buyer_id,pr.protected_until,sa.acceptance_sha256 supplier_hash,ba.acceptance_sha256 buyer_hash from fee_locks f join protected_relationships pr on pr.id=f.relationship_id join agreement_acceptances sa on sa.id=pr.supplier_acceptance_id join agreement_acceptances ba on ba.id=pr.buyer_acceptance_id where f.id=$1 and f.trade_id=$2 and f.state='LOCKED' and pr.protected_until>now()",
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
