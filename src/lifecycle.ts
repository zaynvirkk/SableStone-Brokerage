export const COUNTERPARTY_STATES = [
  "DISCOVERED", "CONTACTED", "QUALIFYING", "VERIFIED", "ACTIVE",
  "REJECTED", "SUPPRESSED", "STALE", "SUSPENDED",
] as const;
export type CounterpartyState = (typeof COUNTERPARTY_STATES)[number];

export const OFFER_STATES = ["DRAFT", "OFFER_ACTIVE", "OFFER_STALE", "OFFER_DEAD"] as const;
export const DEMAND_STATES = ["DRAFT", "DEMAND_ACTIVE", "DEMAND_STALE", "DEMAND_DEAD"] as const;
export type OfferState = (typeof OFFER_STATES)[number];
export type DemandState = (typeof DEMAND_STATES)[number];

export const TRADE_STATES = [
  "MATCHED", "NEGOTIATING", "PROTECTED", "FEE_LOCKED", "IDENTITY_RELEASED",
  "CONTRACTED", "FUNDED", "DISPATCHED", "IN_TRANSIT", "DELIVERED", "ACCEPTED",
  "SETTLED", "RECURRING", "REJECTED", "EXPIRED", "CANCELLED", "DISPUTED_FROZEN",
  "SETTLEMENT_FAILED",
] as const;
export type TradeState = (typeof TRADE_STATES)[number];

const tradeTransitions: Readonly<Record<TradeState, readonly TradeState[]>> = Object.freeze({
  MATCHED: ["NEGOTIATING", "REJECTED", "EXPIRED"],
  NEGOTIATING: ["PROTECTED", "REJECTED", "EXPIRED"],
  PROTECTED: ["FEE_LOCKED", "REJECTED", "EXPIRED"],
  FEE_LOCKED: ["IDENTITY_RELEASED", "REJECTED", "EXPIRED", "SETTLEMENT_FAILED"],
  IDENTITY_RELEASED: ["CONTRACTED", "CANCELLED", "EXPIRED", "SETTLEMENT_FAILED"],
  CONTRACTED: ["FUNDED", "CANCELLED", "EXPIRED", "DISPUTED_FROZEN"],
  FUNDED: ["DISPATCHED", "CANCELLED", "DISPUTED_FROZEN", "SETTLEMENT_FAILED"],
  DISPATCHED: ["IN_TRANSIT", "DISPUTED_FROZEN"],
  IN_TRANSIT: ["DELIVERED", "DISPUTED_FROZEN"],
  DELIVERED: ["ACCEPTED", "DISPUTED_FROZEN"],
  ACCEPTED: ["SETTLED", "DISPUTED_FROZEN", "SETTLEMENT_FAILED"],
  SETTLED: ["RECURRING", "DISPUTED_FROZEN"],
  RECURRING: [], REJECTED: [], EXPIRED: [], CANCELLED: [],
  DISPUTED_FROZEN: [], SETTLEMENT_FAILED: [],
});

export interface TradeTransitionEvidence {
  readonly supplierAccepted: boolean;
  readonly buyerAccepted: boolean;
  readonly commissionLocked: boolean;
  readonly settlementAvailable: boolean;
  readonly identityReleased: boolean;
  readonly supplierIsSeller: boolean;
  readonly sablestoneHasCustody: boolean;
}

export function assertTradeTransition(
  from: TradeState,
  to: TradeState,
  evidence: TradeTransitionEvidence,
): void {
  if (!(tradeTransitions[from] ?? []).includes(to)) {
    throw new Error(`illegal trade transition ${from} -> ${to}`);
  }
  if (!evidence.supplierIsSeller || evidence.sablestoneHasCustody) {
    throw new Error("broker/principal boundary failed");
  }
  if (to === "PROTECTED" && !(evidence.supplierAccepted && evidence.buyerAccepted)) {
    throw new Error("both protected relationship acceptances required");
  }
  if (to === "FEE_LOCKED" && !(evidence.commissionLocked && evidence.settlementAvailable)) {
    throw new Error("independent settlement fee lock required");
  }
  if (to === "IDENTITY_RELEASED") {
    if (!(evidence.supplierAccepted && evidence.buyerAccepted && evidence.commissionLocked && evidence.settlementAvailable)) {
      throw new Error("identity release prerequisites incomplete");
    }
  }
  if (["CONTRACTED", "FUNDED", "DISPATCHED", "IN_TRANSIT", "DELIVERED", "ACCEPTED", "SETTLED", "RECURRING"].includes(to)
      && !evidence.identityReleased) {
    throw new Error("post-release transition requires recorded identity release");
  }
}

export interface DomainEvent<T = Readonly<Record<string, unknown>>> {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly eventTime: string;
  readonly recordedTime: string;
  readonly policyVersion: string;
  readonly payload: T;
}

export class AppendOnlyEventStore {
  readonly #events: DomainEvent[] = [];
  readonly #idempotency = new Map<string, DomainEvent>();

  append<T extends Readonly<Record<string, unknown>>>(event: DomainEvent<T>): DomainEvent<T> {
    if (!event.idempotencyKey.trim()) throw new Error("idempotency key required");
    const existing = this.#idempotency.get(event.idempotencyKey);
    if (existing) {
      if (existing.eventId !== event.eventId) throw new Error("idempotency conflict");
      return existing as DomainEvent<T>;
    }
    const frozen = deepFreeze({ ...event, payload: { ...event.payload } });
    this.#events.push(frozen);
    this.#idempotency.set(event.idempotencyKey, frozen);
    return frozen;
  }

  list(): readonly DomainEvent[] {
    return Object.freeze([...this.#events]);
  }
}

function deepFreeze<T extends object>(value: T): T {
  Object.freeze(value);
  for (const member of Object.values(value)) {
    if (member && typeof member === "object" && !Object.isFrozen(member)) deepFreeze(member);
  }
  return value;
}
