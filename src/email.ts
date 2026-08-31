import { GlobalSuppressionRegistry, type ContactRecord } from "./contacts.js";

export type EmailMode = "SANDBOX" | "PRODUCTION";
export type EmailEventType = "MESSAGE_RECEIVED" | "MESSAGE_SENT" | "BOUNCE";

export interface GmailPushEnvelope {
  readonly externalEventId: string;
  readonly emailAddress: string;
  readonly historyId: bigint;
  readonly publishedAt: string;
  readonly authenticated: boolean;
  readonly audience: string;
}

export interface EmailEvent {
  readonly externalEventId: string;
  readonly type: EmailEventType;
  readonly threadId: string;
  readonly messageId: string;
  readonly sender: string;
  readonly recipient: string;
  readonly occurredAt: string;
  readonly payloadObjectKey: string;
  readonly payloadSha256: string;
}

export class DurableEmailInbox {
  readonly #events = new Map<string, Readonly<EmailEvent>>();
  insert(event: EmailEvent): Readonly<EmailEvent> {
    const existing = this.#events.get(event.externalEventId);
    if (existing) return existing;
    if (!event.payloadObjectKey.trim()) throw new Error("immutable email payload required");
    const stored = Object.freeze({ ...event });
    this.#events.set(event.externalEventId, stored);
    return stored;
  }
  count(): number { return this.#events.size; }
  list(): readonly Readonly<EmailEvent>[] { return Object.freeze([...this.#events.values()]); }
}

export interface HistoryFetchResult {
  readonly fromExclusive: bigint;
  readonly toInclusive: bigint;
  readonly events: readonly EmailEvent[];
}

export class GmailHistoryCursor {
  #historyId: bigint | null = null;
  acceptPush(
    envelope: GmailPushEnvelope,
    expectedAudience: string,
    fetchHistory: (fromExclusive: bigint, toInclusive: bigint) => HistoryFetchResult,
    inbox: DurableEmailInbox,
  ): number {
    if (!envelope.authenticated || envelope.audience !== expectedAudience) throw new Error("unauthenticated Gmail push");
    if (Number.isNaN(Date.parse(envelope.publishedAt))) throw new Error("push timestamp invalid");
    if (this.#historyId !== null && envelope.historyId <= this.#historyId) return 0;
    const from = this.#historyId ?? 0n;
    const result = fetchHistory(from, envelope.historyId);
    if (result.fromExclusive !== from || result.toInclusive !== envelope.historyId) throw new Error("history response range mismatch");
    for (const event of result.events) inbox.insert(event);
    this.#historyId = envelope.historyId;
    return result.events.length;
  }
  current(): bigint | null { return this.#historyId; }
}

export interface OutboundEmail {
  readonly idempotencyKey: string;
  readonly threadId: string | null;
  readonly recipient: string;
  readonly subject: string;
  readonly bodyObjectKey: string;
  readonly messageId?: string;
}

export class EmailTransport {
  readonly #sent = new Map<string, Readonly<OutboundEmail>>();
  constructor(readonly mode: EmailMode, readonly productionAuthorized: boolean) {
    if (mode === "PRODUCTION" && !productionAuthorized) throw new Error("production email transport unavailable");
  }
  send(message: OutboundEmail): Readonly<OutboundEmail> {
    if (!message.idempotencyKey.trim() || !message.bodyObjectKey.trim()) throw new Error("durable outbound message required");
    const prior = this.#sent.get(message.idempotencyKey);
    if (prior) return prior;
    const stored = Object.freeze({ ...message });
    this.#sent.set(message.idempotencyKey, stored);
    return stored;
  }
  count(): number { return this.#sent.size; }
}

export function applyBounce(event: EmailEvent, contact: ContactRecord, suppressions: GlobalSuppressionRegistry): void {
  if (event.type !== "BOUNCE") throw new Error("not a bounce event");
  if (event.recipient.trim().toLowerCase() !== contact.email.trim().toLowerCase()) throw new Error("bounce recipient mismatch");
  suppressions.suppress(contact.email, "BOUNCE", event.externalEventId, event.occurredAt);
}
