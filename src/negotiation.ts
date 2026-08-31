import { compareDecimalStrings } from "./domain.js";
import { addDecimal, decimal, subtractDecimal, type DecimalString } from "./money.js";

export type NegotiationIntent =
  | Readonly<{ type: "COUNTER_PRICE"; pricePerKg: DecimalString; currency: string; sessionRevision: number }>
  | Readonly<{ type: "ACCEPT"; sessionRevision: number }>
  | Readonly<{ type: "REQUEST_CREDIT"; sessionRevision: number }>
  | Readonly<{ type: "ALTER_CONTRACT"; sessionRevision: number }>
  | Readonly<{ type: "WAIVE_COMMISSION"; sessionRevision: number }>;
export interface NegotiationPolicy {
  readonly policyVersion: string;
  readonly currency: string;
  readonly economicFloorPerKg: DecimalString;
  readonly minimumCommissionPerKg: DecimalString;
  readonly maximumConcessionPerKg: DecimalString;
  readonly expiresAt: string;
}
export interface NegotiationSession {
  readonly sessionId: string;
  readonly revision: number;
  readonly offerId: string;
  readonly offerVersion: number;
  readonly demandId: string;
  readonly demandVersion: number;
  readonly policyVersion: string;
  readonly currentQuotePerKg: DecimalString;
  readonly currency: string;
  readonly expiresAt: string;
  readonly status: "OPEN" | "ACCEPTED" | "DECLINED" | "EXPIRED";
}
export interface NegotiationDecision {
  readonly action: "ACCEPT" | "COUNTER" | "DECLINE" | "EXPIRE";
  readonly executablePricePerKg: DecimalString | null;
  readonly nextRevision: number;
  readonly reason: string;
}

export function negotiate(session: NegotiationSession, intent: NegotiationIntent, policy: NegotiationPolicy, now: string): NegotiationDecision {
  if (session.status !== "OPEN" || Date.parse(now) >= Date.parse(session.expiresAt) || Date.parse(now) >= Date.parse(policy.expiresAt)) return decision("EXPIRE", null, session.revision, "NEGOTIATION_EXPIRED");
  if (intent.sessionRevision !== session.revision) return decision("DECLINE", null, session.revision, "STALE_COUNTEROFFER");
  if (session.policyVersion !== policy.policyVersion || session.currency !== policy.currency) return decision("DECLINE", null, session.revision, "POLICY_OR_CURRENCY_DRIFT");
  if (intent.type === "REQUEST_CREDIT") return decision("DECLINE", null, session.revision, "SABLESTONE_CREDIT_FORBIDDEN");
  if (intent.type === "ALTER_CONTRACT") return decision("DECLINE", null, session.revision, "CONTRACT_CHANGE_FORBIDDEN");
  if (intent.type === "WAIVE_COMMISSION") return decision("DECLINE", null, session.revision, "COMMISSION_WAIVER_FORBIDDEN");
  if (intent.type === "ACCEPT") return decision("ACCEPT", session.currentQuotePerKg, session.revision + 1, "CURRENT_QUOTE_ACCEPTED");
  if (intent.currency !== policy.currency) return decision("DECLINE", null, session.revision, "CURRENCY_MISMATCH");
  const minimum = addDecimal(policy.economicFloorPerKg, policy.minimumCommissionPerKg);
  if (compareDecimalStrings(intent.pricePerKg, minimum) < 0) return decision("COUNTER", minimum, session.revision + 1, "BELOW_EXECUTABLE_FLOOR");
  if (compareDecimalStrings(intent.pricePerKg, session.currentQuotePerKg) >= 0) return decision("ACCEPT", intent.pricePerKg, session.revision + 1, "COUNTER_AT_OR_ABOVE_QUOTE");
  const concession = subtractDecimal(session.currentQuotePerKg, intent.pricePerKg);
  if (compareDecimalStrings(concession, policy.maximumConcessionPerKg) > 0) {
    const bounded = subtractDecimal(session.currentQuotePerKg, policy.maximumConcessionPerKg);
    return decision("COUNTER", compareDecimalStrings(bounded, minimum) < 0 ? minimum : bounded, session.revision + 1, "CONCESSION_LIMIT");
  }
  return decision("ACCEPT", intent.pricePerKg, session.revision + 1, "BOUNDED_COUNTER_ACCEPTED");
}
function decision(action: NegotiationDecision["action"], executablePricePerKg: DecimalString | null, nextRevision: number, reason: string): NegotiationDecision {
  return Object.freeze({ action, executablePricePerKg, nextRevision, reason });
}
export function parseCounterPrice(value: string): DecimalString { return decimal(value); }
