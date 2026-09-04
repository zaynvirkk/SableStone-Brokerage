import type { QueryResultRow } from "pg";
import type { WorkflowClient } from "@temporalio/client";
import { DurableInboxRepository, OutboxDispatcher } from "./database.js";
import type { Pool } from "pg";
import type { AuthorityUseGuard } from "./authority_receipts.js";

export type InboxHandler = (event: QueryResultRow) => Promise<void>;

export async function startWorkflowIdempotently(
  temporal: Pick<WorkflowClient, "start">,
  workflow: string,
  options: Parameters<WorkflowClient["start"]>[1],
): Promise<"STARTED" | "ALREADY_STARTED"> {
  try {
    await temporal.start(workflow, options);
    return "STARTED";
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "WorkflowExecutionAlreadyStartedError"
    )
      return "ALREADY_STARTED";
    throw error;
  }
}

export class RuntimeSupervisor {
  readonly inbox: DurableInboxRepository;
  readonly outbox: OutboxDispatcher;
  constructor(
    readonly pool: Pool,
    readonly temporal: WorkflowClient,
    readonly taskQueue: string,
    readonly inboxHandlers: Readonly<Record<string, InboxHandler>>,
    readonly activationGuard?: AuthorityUseGuard,
  ) {
    this.inbox = new DurableInboxRepository(pool);
    this.outbox = new OutboxDispatcher(pool, (event) => this.publish(event));
  }
  async tick(): Promise<{ inbox: number; outbox: number }> {
    await this.activationGuard?.assertCurrent();
    let processed = 0;
    for (const event of await this.inbox.claim(50)) {
      const provider = String(event.provider),
        handler = this.inboxHandlers[provider];
      try {
        if (!handler)
          throw new Error(`inbox provider unsupported: ${provider}`);
        await handler(event);
        await this.inbox.complete(
          provider,
          String(event.external_event_id),
          "PROCESSED",
        );
        processed++;
      } catch (error) {
        const message=(error as Error).message;
        if(/signature invalid|replay conflict|unsupported settlement event|semantically impossible/i.test(message))
          await this.inbox.reject(provider,String(event.external_event_id),"PERMANENT_INVALID");
        else
          await this.inbox.fail(
            provider,
            String(event.external_event_id),
            (error as Error).name,
          );
      }
    }
    return { inbox: processed, outbox: await this.outbox.dispatchBatch(50) };
  }
  async run(signal: AbortSignal, intervalMs = 1000): Promise<void> {
    if (intervalMs < 100 || intervalMs > 60_000)
      throw new Error("supervisor interval invalid");
    while (!signal.aborted) {
      await this.tick();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, intervalMs);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }
  private async publish(event: QueryResultRow): Promise<void> {
    const eventType = String(event.event_type),
      aggregateId = String(event.aggregate_id),
      workflow = routeWorkflow(eventType);
    if (!workflow) return;
    await startWorkflowIdempotently(this.temporal, workflow.name, {
      taskQueue: this.taskQueue,
      workflowId:
        eventType === "MATCH_SWEEP_CONTINUE"
          ? `${workflow.name}:${String(event.event_id)}`
          : `${workflow.name}:${aggregateId}:${eventType}`,
      args: [workflow.args(event)],
    });
  }
}
function routeWorkflow(eventType: string): {
  name: string;
  args: (event: QueryResultRow) => Readonly<Record<string, unknown>>;
} | null {
  if (
    eventType === "OFFER_VERSION_ADDED" ||
    eventType === "DEMAND_VERSION_ADDED" ||
    eventType === "MATCH_SWEEP_CONTINUE"
  )
    return {
      name: "MatchWorkflow",
      args: (event) =>
        eventType === "MATCH_SWEEP_CONTINUE"
          ? {
              offerId: String((event.payload as Record<string, unknown>).offerId),
              demandId: String((event.payload as Record<string, unknown>).demandId),
            }
          : eventType === "OFFER_VERSION_ADDED"
          ? { offerId: String(event.aggregate_id), demandId: "AUTO_SELECT" }
          : { offerId: "AUTO_SELECT", demandId: String(event.aggregate_id) },
    };
  if (eventType === "MATCH_EXECUTABLE")
    return {
      name: "NegotiationWorkflow",
      args: (event) => ({
        matchId: String(event.aggregate_id),
        maximumRounds: 168,
      }),
    };
  if (eventType === "PROTECTED_ACCEPTANCES_COMPLETE")
    return {
      name: "ProtectedRelationshipWorkflow",
      args: (event) => ({ matchId: String(event.aggregate_id) }),
    };
  if (eventType === "TRADE_PROTECTED")
    return {
      name: "SettlementWorkflow",
      args: (event) => ({
        tradeId: String(event.aggregate_id),
        provider: "AUTO_ROUTE",
      }),
    };
  if (eventType === "ENTITLEMENT_SECURED")
    return {
      name: "SettlementWorkflow",
      args: (event) => ({
        tradeId: String(event.aggregate_id),
        provider: "AUTO_ROUTE",
      }),
    };
  if (eventType === "SHIPMENT_EVENT_RECORDED")
    return {
      name: "ShipmentWorkflow",
      args: (event) => ({ tradeId: String(event.aggregate_id) }),
    };
  if (eventType === "TRADE_ACCEPTED")
    return {
      name: "RecurringDemandWorkflow",
      args: (event) => ({ tradeId: String(event.aggregate_id) }),
    };
  return null;
}
