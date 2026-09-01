import { randomUUID, createHash } from "node:crypto";
import type { Pool } from "pg";
import { inTransaction, TransactionalOutboxRepository } from "./database.js";
import type {
  BrokerageActivities,
  WorkflowReceipt,
} from "../workflows/production.js";
import type { AuthorityUseGuard } from "./authority_receipts.js";
export type StageName =
  | "DISCOVER_SUPPLIER"
  | "DISCOVER_BUYER"
  | "QUALIFY"
  | "MATCH"
  | "NEGOTIATE"
  | "PROTECT"
  | "LOCK_SETTLEMENT"
  | "RELEASE_IDENTITY"
  | "MONITOR_SHIPMENT"
  | "RECONCILE"
  | "RECUR";
export interface StageResult {
  readonly state: "ACCEPTED" | "REJECTED" | "UNKNOWN";
  readonly sourceReceiptIds: readonly string[];
  readonly facts: Readonly<Record<string, unknown>>;
}
export type StageHandler = (
  input: Readonly<Record<string, unknown>>,
) => Promise<StageResult>;
export class ProductionActivityService implements BrokerageActivities {
  readonly outbox: TransactionalOutboxRepository;
  constructor(
    readonly pool: Pool,
    readonly handlers: Readonly<Partial<Record<StageName, StageHandler>>>,
    readonly activationGuard?: AuthorityUseGuard,
  ) {
    this.outbox = new TransactionalOutboxRepository(pool);
  }
  private async run(
    stage: StageName,
    input: Readonly<Record<string, unknown>>,
  ): Promise<WorkflowReceipt> {
    await this.activationGuard?.assertCurrent();
    const handler = this.handlers[stage];
    if (!handler)
      return Object.freeze({
        receiptId: `unavailable:${stage}`,
        digest: "0".repeat(64),
        state: "UNKNOWN",
      });
    const result = await handler(input);
    if (result.state === "ACCEPTED" && !result.sourceReceiptIds.length)
      throw new Error(`${stage} accepted without source receipt`);
    const digest = createHash("sha256")
        .update(JSON.stringify({ stage, input, result }))
        .digest("hex"),
      receiptId = randomUUID();
    await inTransaction(this.pool, async (client) => {
      await client.query(
        "insert into workflow_stage_receipts(id,stage,input_digest,result_digest,state,source_receipt_ids,facts) values($1,$2,$3,$4,$5,$6,$7)",
        [
          receiptId,
          stage,
          createHash("sha256").update(JSON.stringify(input)).digest("hex"),
          digest,
          result.state,
          result.sourceReceiptIds,
          result.facts,
        ],
      );
      await this.outbox.append(client, {
        id: randomUUID(),
        aggregateType: "WORKFLOW_STAGE",
        aggregateId: receiptId,
        eventType: `${stage}_${result.state}`,
        payload: { receiptId, digest },
        idempotencyKey: `stage:${stage}:${digest}`,
      });
    });
    return Object.freeze({ receiptId, digest, state: result.state });
  }
  discoverSupplier(input: { sourceId: string; cursor: string | null }) {
    return this.run("DISCOVER_SUPPLIER", input);
  }
  discoverBuyer(input: { sourceId: string; cursor: string | null }) {
    return this.run("DISCOVER_BUYER", input);
  }
  qualify(input: { organizationId: string; role: "SUPPLIER" | "BUYER" }) {
    return this.run("QUALIFY", input);
  }
  match(input: { offerId: string; demandId: string }) {
    return this.run("MATCH", input);
  }
  negotiate(input: { matchId: string; round: number }) {
    return this.run("NEGOTIATE", input);
  }
  protect(input: { matchId: string }) {
    return this.run("PROTECT", input);
  }
  lockSettlement(input: { tradeId: string; provider: string }) {
    return this.run("LOCK_SETTLEMENT", input);
  }
  releaseIdentity(input: { tradeId: string; feeLockReceiptId: string }) {
    return this.run("RELEASE_IDENTITY", input);
  }
  monitorShipment(input: { tradeId: string }) {
    return this.run("MONITOR_SHIPMENT", input);
  }
  reconcile(input: { tradeId: string }) {
    return this.run("RECONCILE", input);
  }
  recur(input: { tradeId: string }) {
    return this.run("RECUR", input);
  }
}

export function bindBrokerageActivities(
  service: ProductionActivityService,
): BrokerageActivities {
  const activities: BrokerageActivities = {
    discoverSupplier: (input) => service.discoverSupplier(input),
    discoverBuyer: (input) => service.discoverBuyer(input),
    qualify: (input) => service.qualify(input),
    match: (input) => service.match(input),
    negotiate: (input) => service.negotiate(input),
    protect: (input) => service.protect(input),
    lockSettlement: (input) => service.lockSettlement(input),
    releaseIdentity: (input) => service.releaseIdentity(input),
    monitorShipment: (input) => service.monitorShipment(input),
    reconcile: (input) => service.reconcile(input),
    recur: (input) => service.recur(input),
  };
  return Object.freeze(activities);
}
