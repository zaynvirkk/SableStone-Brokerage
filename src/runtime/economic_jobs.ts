import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { calculateEconomicFloor, type CostComponent } from "../costs.js";
import {
  ProductionEconomicQuoteConnector,
  type EconomicQuoteHttpConfig,
  type QuotedCostKind,
} from "../connectors/economic_quotes.js";
import { decimal } from "../money.js";
import { priceMatch, type PricingPolicy } from "../pricing.js";
import type { ImmutableEvidenceStore } from "./object_store.js";
import { inTransaction, TransactionalOutboxRepository } from "./database.js";
import { assertCurrentAuthorityReceipt } from "./authority_receipts.js";
import { DatabaseAuthorityUseGuard } from "./authority_receipts.js";
import {
  assertCurrentCredentialBinding,
  DatabaseCredentialUseGuard,
} from "./production_credentials.js";
import { createPinnedPublicFetch } from "./public_network.js";
import { refreshMatchPriority } from "./opportunity_priority.js";

export async function buildEconomicQuoteConnectors(
  pool: Pool,
  store: ImmutableEvidenceStore,
  serialized: string | undefined,
): Promise<readonly ProductionEconomicQuoteConnector[]> {
  if (!serialized) return Object.freeze([]);
  const configs = JSON.parse(serialized) as EconomicQuoteHttpConfig[];
  if (!Array.isArray(configs) || configs.length > 10)
    throw new Error("economic quote configuration invalid");
  const connectors = [];
  for (const config of configs) {
    await assertCurrentAuthorityReceipt(
      pool,
      config.approvalReceiptId,
      "ECONOMIC_QUOTE_PROVIDER_APPROVAL",
    );
    const credentialInput = {
      provider: config.provider,
      capability: "ECONOMIC_QUOTE_API",
      environment: "PRODUCTION",
      credentialParts: [config.authorizationHeader],
    } as const;
    await assertCurrentCredentialBinding(pool, credentialInput);
    connectors.push(
      new ProductionEconomicQuoteConnector(
        config,
        store,
        createPinnedPublicFetch(),
        new DatabaseCredentialUseGuard(pool, credentialInput),
        new DatabaseAuthorityUseGuard(
          pool,
          config.approvalReceiptId,
          "ECONOMIC_QUOTE_PROVIDER_APPROVAL",
        ),
      ),
    );
  }
  return Object.freeze(connectors);
}

export class EconomicQuoteJobDispatcher {
  constructor(
    readonly pool: Pool,
    readonly connectors: readonly ProductionEconomicQuoteConnector[],
  ) {}
  async dispatchBatch(limit = 20): Promise<number> {
    const kinds = [
      ...new Set(
        this.connectors.flatMap((connector) => connector.config.costKinds),
      ),
    ];
    if (!kinds.length) return 0;
    const jobs = await inTransaction(
      this.pool,
      async (client) =>
        (
          await client.query(
            "with claimed as(select j.id from economic_quote_jobs j join matches m on m.id=j.match_id where (j.state='PENDING' or(j.state='PROCESSING' and j.claimed_at<now()-interval '10 minutes')) and j.cost_kind=any($2) order by m.priority_score desc,j.created_at for update of j skip locked limit $1) update economic_quote_jobs j set state='PROCESSING',attempts=attempts+1,claimed_at=now() from claimed where j.id=claimed.id returning j.*",
            [limit, kinds],
          )
        ).rows,
    );
    let completed = 0;
    for (const job of jobs) {
      const connector = this.connectors.find((value) =>
        value.config.costKinds.includes(job.cost_kind),
      );
      if (!connector) continue;
      try {
        const facts = (
          await this.pool.query(
            "select m.id,o.product_family,o.product_spec offer_spec,o.currency,o.supplier_net,d.product_spec demand_spec,d.quantity_mt from matches m join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version where m.id=$1 and m.compatible",
            [job.match_id],
          )
        ).rows[0];
        if (!facts) throw new Error("compatible match unavailable");
        const quote = await connector.quote({
          matchId: job.match_id,
          costKind: job.cost_kind,
          productFamily: facts.product_family,
          quantityMt: String(facts.quantity_mt),
          offerSpec: facts.offer_spec,
          demandSpec: facts.demand_spec,
          currency: facts.currency,
        });
        await inTransaction(this.pool, async (client) => {
          const receiptId = randomUUID();
          await client.query(
            "insert into economic_quote_receipts(id,provider,external_reference,cost_kind,request_object_key,response_object_key,response_sha256,quoted_at) values($1,$2,$3,$4,$5,$6,$7,now())",
            [
              receiptId,
              quote.provider,
              quote.externalReference,
              quote.costKind,
              quote.requestObjectKey,
              quote.responseObjectKey,
              quote.responseSha256,
            ],
          );
          await client.query(
            "insert into cost_components(id,match_id,cost_kind,amount_per_kg,currency,evidence,source_receipt_id,valid_until,basis,payer_role,settlement_treatment,beneficiary_role,beneficiary_id) values($1,$2,$3,$4,$5,'FIRM',$6,$7,$8,$9,$10,$11,$12) on conflict(match_id,cost_kind) do nothing",
            [
              randomUUID(),
              job.match_id,
              quote.costKind,
              quote.amountPerKg,
              quote.currency,
              receiptId,
              quote.validUntil,
              `${quote.provider}:${quote.externalReference}`,
              connector.config.allocationPolicies.find(
                (policy) => policy.costKind === quote.costKind,
              )?.payerRole,
              connector.config.allocationPolicies.find(
                (policy) => policy.costKind === quote.costKind,
              )?.settlementTreatment,
              connector.config.allocationPolicies.find(
                (policy) => policy.costKind === quote.costKind,
              )?.beneficiaryRole,
              connector.config.allocationPolicies.find(
                (policy) => policy.costKind === quote.costKind,
              )?.beneficiaryId,
            ],
          );
          await client.query(
            "update economic_quote_jobs set state='COMPLETED',completed_at=now(),claimed_at=null where id=$1 and state='PROCESSING'",
            [job.id],
          );
        });
        await evaluateEconomics(this.pool, job.match_id);
        completed++;
      } catch (error) {
        await this.pool.query(
          "update economic_quote_jobs set state=case when attempts>=5 then 'FAILED' else 'PENDING' end,completed_at=case when attempts>=5 then now() else null end,claimed_at=null,last_error_code=$2 where id=$1 and state='PROCESSING'",
          [job.id, (error as Error).name.slice(0, 100)],
        );
      }
    }
    return completed;
  }
}

/** Re-evaluates fully quoted matches after an operator-approved pricing or
 * negotiation policy becomes effective. This keeps policy activation from
 * requiring a synthetic quote retry or a manual database touch. */
export class EconomicEvaluationDispatcher {
  constructor(readonly pool: Pool) {}
  async dispatchBatch(limit = 20): Promise<number> {
    const rows = (
      await this.pool.query(
        "select f.match_id from economic_floors f join matches m on m.id=f.match_id left join negotiations n on n.match_id=f.match_id where f.state='KNOWN' and n.id is null order by m.priority_score desc,f.calculated_at limit $1",
        [limit],
      )
    ).rows;
    let executable = 0;
    for (const row of rows)
      if ((await evaluateEconomics(this.pool, row.match_id)) === "EXECUTABLE")
        executable++;
    return executable;
  }
}

export async function ensureEconomicJobs(
  pool: Pool,
  matchId: string,
  offer: {
    source_event_id: string;
    supplier_net: string | number;
    currency: string;
    expires_at: string;
  },
): Promise<void> {
  await inTransaction(pool, async (client) => {
    await client.query(
      "insert into cost_components(id,match_id,cost_kind,amount_per_kg,currency,evidence,source_receipt_id,valid_until,basis,payer_role,settlement_treatment,beneficiary_role) values($1,$2,'SUPPLIER_NET',$3,$4,'FIRM',$5,$6,'supplier source-stated net verified through qualification','BUYER','SUPPLIER_ENTITLEMENT','SUPPLIER') on conflict(match_id,cost_kind) do nothing",
      [
        randomUUID(),
        matchId,
        String(offer.supplier_net),
        offer.currency,
        offer.source_event_id,
        offer.expires_at,
      ],
    );
    for (const kind of [
      "FREIGHT",
      "INSPECTION",
      "PAYMENT_RAIL",
      "TAX_CHARGE",
      "RISK_RESERVE",
    ] as const)
      await client.query(
        "insert into economic_quote_jobs(id,match_id,cost_kind,state) values($1,$2,$3,'PENDING') on conflict(match_id,cost_kind) do nothing",
        [randomUUID(), matchId, kind],
      );
  });
}

export async function evaluateEconomics(
  pool: Pool,
  matchId: string,
): Promise<"UNKNOWN" | "REJECTED" | "EXECUTABLE"> {
  return inTransaction(pool, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `economics:${matchId}`,
    ]);
    const components = (
        await client.query(
          "select * from cost_components where match_id=$1 order by cost_kind",
          [matchId],
        )
      ).rows.map((row) => ({
        kind: row.cost_kind,
        amountPerKg:
          row.amount_per_kg === null
            ? null
            : decimal(String(row.amount_per_kg)),
        currency: row.currency,
        evidence: row.evidence,
        sourceReceiptId: row.source_receipt_id,
        validUntil: row.valid_until
          ? new Date(row.valid_until).toISOString()
          : null,
        basis: row.basis,
        payerRole: row.payer_role,
        settlementTreatment: row.settlement_treatment,
        beneficiaryRole: row.beneficiary_role,
        beneficiaryId: row.beneficiary_id,
      })) as CostComponent[],
      now = new Date().toISOString(),
      floor = calculateEconomicFloor(components, now);
    await client.query(
      "insert into economic_floors(match_id,state,amount_per_kg,currency,component_digest,reasons,calculated_at) values($1,$2,$3,$4,$5,$6,now()) on conflict(match_id) do update set state=excluded.state,amount_per_kg=excluded.amount_per_kg,currency=excluded.currency,component_digest=excluded.component_digest,reasons=excluded.reasons,calculated_at=excluded.calculated_at",
      [
        matchId,
        floor.state,
        floor.state === "KNOWN" ? floor.amountPerKg : null,
        floor.state === "KNOWN" ? floor.currency : null,
        floor.state === "KNOWN"
          ? createHash("sha256")
              .update(JSON.stringify(floor.componentReceiptIds))
              .digest("hex")
          : null,
        floor.state === "UNKNOWN" ? floor.reasons : [],
      ],
    );
    if (floor.state === "UNKNOWN") return "UNKNOWN";
    const facts = (
        await client.query(
          "select m.offer_version,m.demand_version,d.buyer_ceiling,d.ceiling_state,d.currency,d.source_event_id from matches m join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version where m.id=$1",
          [matchId],
        )
      ).rows[0],
      row = (
        await client.query(
          "select p.* from pricing_policies p join authority_receipts a on a.receipt_id=p.approval_receipt_id where p.currency=$1 and p.valid_from<=now() and p.valid_until>now() and a.authority_kind='PRICING_POLICY_APPROVAL' and a.retrieved_at<=now() and a.effective_at<=now() and a.expires_at>now() order by p.valid_from desc limit 1",
          [floor.currency],
        )
      ).rows[0];
    if (!row) return "UNKNOWN";
    const policy: PricingPolicy = {
        policyId: row.id,
        version: row.version,
        currency: row.currency,
        commissionFloorPerKg: decimal(String(row.commission_floor_per_kg)),
        surplusCaptureRate: decimal(String(row.surplus_capture_rate)),
        hardCommissionCapPerKg: decimal(String(row.hard_commission_cap_per_kg)),
        validFrom: new Date(row.valid_from).toISOString(),
        validUntil: new Date(row.valid_until).toISOString(),
        approvalReceiptId: row.approval_receipt_id,
        evidenceState: row.evidence_state,
      },
      decision = priceMatch(
        floor,
        facts.ceiling_state === "KNOWN"
          ? {
              state: "KNOWN",
              value: {
                value: decimal(String(facts.buyer_ceiling)),
                currency: facts.currency,
              },
              sourceDocumentId: facts.source_event_id,
            }
          : { state: "UNKNOWN" },
        policy,
        now,
      );
    await client.query(
      "insert into pricing_decisions(match_id,policy_id,policy_version,state,available_surplus_per_kg,commission_per_kg,buyer_executable_price_per_kg,currency,reasons,calculated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) on conflict(match_id) do update set state=excluded.state,available_surplus_per_kg=excluded.available_surplus_per_kg,commission_per_kg=excluded.commission_per_kg,buyer_executable_price_per_kg=excluded.buyer_executable_price_per_kg,currency=excluded.currency,reasons=excluded.reasons,calculated_at=excluded.calculated_at",
      [
        matchId,
        policy.policyId,
        policy.version,
        decision.state,
        decision.state === "EXECUTABLE" ? decision.availableSurplusPerKg : null,
        decision.state === "EXECUTABLE" ? decision.commissionPerKg : null,
        decision.state === "EXECUTABLE"
          ? decision.buyerExecutablePricePerKg
          : null,
        decision.state === "EXECUTABLE" ? decision.currency : null,
        "reasons" in decision ? decision.reasons : [],
      ],
    );
    if (decision.state !== "EXECUTABLE") return decision.state;
    const negotiationPolicy = (
      await client.query(
        "select p.* from negotiation_policies p join authority_receipts a on a.receipt_id=p.authority_receipt_id where p.currency=$1 and p.valid_from<=now() and p.valid_until>now() and a.authority_kind='NEGOTIATION_POLICY_APPROVAL' and a.retrieved_at<=now() and a.effective_at<=now() and a.expires_at>now() order by p.valid_from desc limit 1",
        [decision.currency],
      )
    ).rows[0];
    if (!negotiationPolicy) return "UNKNOWN";
    let negotiation = (
      await client.query("select id from negotiations where match_id=$1", [
        matchId,
      ])
    ).rows[0];
    if (!negotiation) {
      const eventId = randomUUID(),
        negotiationId = randomUUID(),
        expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
      await client.query(
        "insert into domain_events(event_id,idempotency_key,aggregate_type,aggregate_id,event_type,event_time,policy_version,payload) values($1,$2,'MATCH',$3,'NEGOTIATION_OPENED',now(),$4,$5) on conflict(idempotency_key) do nothing",
        [
          eventId,
          `match:${matchId}:negotiation-opened`,
          matchId,
          negotiationPolicy.version,
          {
            quote: decision.buyerExecutablePricePerKg,
            currency: decision.currency,
          },
        ],
      );
      const storedEvent = (
        await client.query(
          "select event_id from domain_events where idempotency_key=$1",
          [`match:${matchId}:negotiation-opened`],
        )
      ).rows[0];
      await client.query(
        "insert into negotiations(id,revision,match_id,offer_version,demand_version,pricing_policy_id,pricing_policy_version,current_quote_per_kg,currency,status,expires_at,last_event_id) values($1,0,$2,$3,$4,$5,$6,$7,$8,'OPEN',$9,$10) on conflict(match_id) do nothing",
        [
          negotiationId,
          matchId,
          facts.offer_version,
          facts.demand_version,
          policy.policyId,
          policy.version,
          decision.buyerExecutablePricePerKg,
          decision.currency,
          expiresAt,
          storedEvent.event_id,
        ],
      );
      negotiation = (
        await client.query("select id from negotiations where match_id=$1", [
          matchId,
        ])
      ).rows[0];
      for (const role of ["SUPPLIER", "BUYER"])
        await client.query(
          "insert into commercial_notification_jobs(id,match_id,negotiation_id,recipient_role,state) values($1,$2,$3,$4,'PENDING') on conflict(negotiation_id,recipient_role) do nothing",
          [randomUUID(), matchId, negotiation.id, role],
        );
    }
    const outbox = new TransactionalOutboxRepository(pool);
    await outbox.append(client, {
      id: randomUUID(),
      aggregateType: "MATCH",
      aggregateId: matchId,
      eventType: "MATCH_EXECUTABLE",
      payload: {
        matchId,
        price: decision.buyerExecutablePricePerKg,
        currency: decision.currency,
      },
      idempotencyKey: `match:${matchId}:executable`,
    });
    await refreshMatchPriority(client, matchId);
    return "EXECUTABLE";
  });
}
