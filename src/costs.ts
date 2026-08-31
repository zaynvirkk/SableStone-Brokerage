import { addDecimal, decimal, type DecimalString } from "./money.js";

export type CostKind = "SUPPLIER_NET" | "FREIGHT" | "INSPECTION" | "PAYMENT_RAIL" | "TAX_CHARGE" | "RISK_RESERVE";
export type CostEvidence = "FIRM" | "ESTIMATE" | "UNKNOWN";
export interface CostComponent {
  readonly kind: CostKind;
  readonly amountPerKg: DecimalString | null;
  readonly currency: string;
  readonly evidence: CostEvidence;
  readonly sourceReceiptId: string | null;
  readonly validUntil: string | null;
  readonly basis: string;
}
export type EconomicFloor =
  | Readonly<{ state: "KNOWN"; amountPerKg: DecimalString; currency: string; componentReceiptIds: readonly string[] }>
  | Readonly<{ state: "UNKNOWN"; reasons: readonly string[] }>;

const REQUIRED: readonly CostKind[] = ["SUPPLIER_NET", "FREIGHT", "INSPECTION", "PAYMENT_RAIL", "TAX_CHARGE", "RISK_RESERVE"];

export function calculateEconomicFloor(components: readonly CostComponent[], now: string): EconomicFloor {
  const reasons: string[] = [];
  const currency = components[0]?.currency;
  for (const kind of REQUIRED) {
    const candidates = components.filter((component) => component.kind === kind);
    if (candidates.length !== 1) { reasons.push(`${kind}:REQUIRES_EXACTLY_ONE`); continue; }
    const component = candidates[0];
    if (!component) continue;
    if (component.evidence !== "FIRM") reasons.push(`${kind}:NOT_FIRM`);
    if (component.amountPerKg === null) reasons.push(`${kind}:AMOUNT_UNKNOWN`);
    if (!component.sourceReceiptId) reasons.push(`${kind}:SOURCE_MISSING`);
    if (!component.validUntil || Date.parse(component.validUntil) <= Date.parse(now)) reasons.push(`${kind}:STALE`);
    if (component.currency !== currency) reasons.push(`${kind}:CURRENCY_MISMATCH`);
    if (!component.basis.trim()) reasons.push(`${kind}:BASIS_MISSING`);
  }
  if (reasons.length || !currency) return Object.freeze({ state: "UNKNOWN", reasons: Object.freeze(reasons) });
  let total = decimal("0");
  const receipts: string[] = [];
  for (const component of components) {
    if (component.amountPerKg === null || !component.sourceReceiptId) throw new Error("cost invariant lost");
    if (component.amountPerKg.startsWith("-")) return Object.freeze({ state: "UNKNOWN", reasons: Object.freeze([`${component.kind}:NEGATIVE`]) });
    total = addDecimal(total, component.amountPerKg);
    receipts.push(component.sourceReceiptId);
  }
  return Object.freeze({ state: "KNOWN", amountPerKg: total, currency, componentReceiptIds: Object.freeze(receipts) });
}
