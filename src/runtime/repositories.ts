import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { inTransaction, TransactionalOutboxRepository } from "./database.js";
import type { DecimalString } from "../money.js";
import type { TradeState } from "../lifecycle.js";

export interface PersistedOfferInput {
  readonly id: string;
  readonly version: number;
  readonly supplierId: string;
  readonly sourceEventId: string;
  readonly supersedesOfferId: string | null;
  readonly productFamily: string;
  readonly productSpec: Readonly<Record<string, unknown>>;
  readonly quantityMt: DecimalString;
  readonly moqMt: DecimalString;
  readonly supplierNet: DecimalString;
  readonly currency: string;
  readonly expiresAt: string;
  readonly verification: "DRAFT" | "VERIFIED" | "REJECTED";
  readonly freshness: "CURRENT" | "STALE" | "EXPIRED";
}
export interface PersistedDemandInput {
  readonly id: string;
  readonly version: number;
  readonly buyerId: string;
  readonly sourceEventId: string;
  readonly productFamily: string;
  readonly productSpec: Readonly<Record<string, unknown>>;
  readonly quantityMt: DecimalString;
  readonly buyerCeiling: DecimalString | null;
  readonly currency: string | null;
  readonly standing: boolean;
  readonly expiresAt: string;
  readonly verification: "DRAFT" | "VERIFIED" | "REJECTED";
  readonly freshness: "CURRENT" | "STALE" | "EXPIRED";
}

export class BrokerageRepository {
  readonly outbox: TransactionalOutboxRepository;
  constructor(readonly pool: Pool) { this.outbox = new TransactionalOutboxRepository(pool); }

  async addOffer(input: PersistedOfferInput): Promise<void> {
    await inTransaction(this.pool, async client => {
      if (input.version > 1) await lockPreviousOffer(client, input);
      await client.query(
        "insert into supplier_offers(id,version,supplier_id,source_event_id,supersedes_offer_id,product_family,product_spec,quantity_mt,moq_mt,supplier_net,currency,expires_at,verification,freshness) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        [input.id,input.version,input.supplierId,input.sourceEventId,input.supersedesOfferId,input.productFamily,input.productSpec,input.quantityMt,input.moqMt,input.supplierNet,input.currency,input.expiresAt,input.verification,input.freshness],
      );
      await this.outbox.append(client, event("SUPPLIER_OFFER", input.id, "OFFER_VERSION_ADDED", { id: input.id, version: input.version }, `offer:${input.id}:${input.version}`));
    });
  }
  async addDemand(input: PersistedDemandInput): Promise<void> {
    await inTransaction(this.pool, async client => {
      const ceilingState = input.buyerCeiling === null ? "UNKNOWN" : "KNOWN";
      await client.query(
        "insert into buyer_demands(id,version,buyer_id,source_event_id,product_family,product_spec,quantity_mt,buyer_ceiling,ceiling_state,currency,standing,expires_at,verification,freshness) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        [input.id,input.version,input.buyerId,input.sourceEventId,input.productFamily,input.productSpec,input.quantityMt,input.buyerCeiling,ceilingState,input.currency,input.standing,input.expiresAt,input.verification,input.freshness],
      );
      await this.outbox.append(client, event("BUYER_DEMAND", input.id, "DEMAND_VERSION_ADDED", { id: input.id, version: input.version }, `demand:${input.id}:${input.version}`));
    });
  }
  async createTrade(input:{id:string;matchId:string;supplierId:string;buyerId:string;relationshipId:string|null;state:TradeState;geography:"DOMESTIC_INDIA"|"INTERNATIONAL";relationshipMaturity:"NEW"|"ESTABLISHED";hasDocumentaryLc:boolean}):Promise<void>{
    await inTransaction(this.pool,async client=>{await client.query("insert into trades(id,match_id,supplier_id,buyer_id,relationship_id,state,geography,relationship_maturity,has_documentary_lc) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",[input.id,input.matchId,input.supplierId,input.buyerId,input.relationshipId,input.state,input.geography,input.relationshipMaturity,input.hasDocumentaryLc]);await this.outbox.append(client,event("TRADE",input.id,"TRADE_CREATED",{state:input.state},`trade:${input.id}:created`))});
  }
  async transitionTrade(input:{tradeId:string;from:TradeState;to:TradeState;eventId:string;policyVersion:string;payload:Readonly<Record<string,unknown>>}):Promise<void>{
    await inTransaction(this.pool,async client=>{const updated=await client.query("update trades set state=$3,updated_at=now() where id=$1 and state=$2 returning id",[input.tradeId,input.from,input.to]);if((updated.rowCount??0)!==1)throw new Error("trade transition concurrency conflict");await client.query("insert into domain_events(event_id,idempotency_key,aggregate_type,aggregate_id,event_type,event_time,policy_version,payload) values($1,$2,'TRADE',$3,$4,now(),$5,$6)",[input.eventId,`trade:${input.tradeId}:${input.to}`,input.tradeId,input.to,input.policyVersion,input.payload]);await this.outbox.append(client,event("TRADE",input.tradeId,`TRADE_${input.to}`,input.payload,`outbox:trade:${input.tradeId}:${input.to}`))});
  }
  async executableOffers(now:string,limit=100){return (await this.pool.query("select * from supplier_offers o where verification='VERIFIED' and freshness='CURRENT' and expires_at>$1 and version=(select max(version) from supplier_offers x where x.id=o.id) order by created_at limit $2",[now,limit])).rows}
  async executableDemands(now:string,limit=100){return (await this.pool.query("select * from buyer_demands d where verification='VERIFIED' and freshness='CURRENT' and expires_at>$1 and version=(select max(version) from buyer_demands x where x.id=d.id) order by created_at limit $2",[now,limit])).rows}
}
async function lockPreviousOffer(client:PoolClient,input:PersistedOfferInput){if(!input.supersedesOfferId)throw new Error("offer supersession required");const prior=await client.query<{version:number}>("select version from supplier_offers where id=$1 order by version desc limit 1 for update",[input.supersedesOfferId]);if(prior.rows[0]?.version!==input.version-1)throw new Error("offer version chain conflict")}
function event(aggregateType:string,aggregateId:string,eventType:string,payload:Readonly<Record<string,unknown>>,idempotencyKey:string){return{id:randomUUID(),aggregateType,aggregateId,eventType,payload,idempotencyKey}}
