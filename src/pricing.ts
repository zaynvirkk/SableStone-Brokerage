import type { EconomicFloor } from "./costs.js";
import { compareDecimalStrings, type EvidenceValue } from "./domain.js";
import { addDecimal, decimal, divideDecimal, maxDecimal, minDecimal, multiplyDecimal, subtractDecimal, type DecimalString } from "./money.js";

export interface PricingPolicy {
  readonly policyId: string;
  readonly version: string;
  readonly currency: string;
  readonly commissionFloorPerKg: DecimalString;
  readonly surplusCaptureRate: DecimalString;
  readonly hardCommissionCapPerKg: DecimalString;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly approvalReceiptId: string;
  readonly evidenceState: "HYPOTHESIS" | "CALIBRATED";
}
export type PricingDecision =
  | Readonly<{ state: "EXECUTABLE"; policyId: string; policyVersion: string; availableSurplusPerKg: DecimalString; commissionPerKg: DecimalString; buyerExecutablePricePerKg: DecimalString; currency: string }>
  | Readonly<{ state: "REJECTED" | "UNKNOWN"; reasons: readonly string[] }>;

export function priceMatch(floor: EconomicFloor, buyerCeiling: EvidenceValue<Readonly<{ value: DecimalString; currency: string }>>, policy: PricingPolicy, now: string): PricingDecision {
  const reasons: string[] = [];
  if (floor.state === "UNKNOWN") reasons.push("ECONOMIC_FLOOR_UNKNOWN");
  if (buyerCeiling.state === "UNKNOWN") reasons.push("BUYER_CEILING_UNKNOWN");
  if (Date.parse(now) < Date.parse(policy.validFrom) || Date.parse(now) >= Date.parse(policy.validUntil)) reasons.push("PRICING_POLICY_NOT_CURRENT");
  if (!policy.approvalReceiptId.trim()) reasons.push("PRICING_POLICY_UNAPPROVED");
  if (reasons.length || floor.state === "UNKNOWN" || buyerCeiling.state === "UNKNOWN") return Object.freeze({ state: "UNKNOWN", reasons: Object.freeze(reasons) });
  if (floor.currency !== buyerCeiling.value.currency || floor.currency !== policy.currency) return Object.freeze({ state: "REJECTED", reasons: Object.freeze(["CURRENCY_MISMATCH"]) });
  const surplus = subtractDecimal(buyerCeiling.value.value, floor.amountPerKg);
  if (compareDecimalStrings(surplus, decimal("0")) <= 0) return Object.freeze({ state: "REJECTED", reasons: Object.freeze(["NO_POSITIVE_SURPLUS"]) });
  const target = maxDecimal(policy.commissionFloorPerKg, multiplyDecimal(policy.surplusCaptureRate, surplus));
  const commission = minDecimal(target, policy.hardCommissionCapPerKg);
  if (compareDecimalStrings(commission, surplus) > 0) return Object.freeze({ state: "REJECTED", reasons: Object.freeze(["SURPLUS_BELOW_COMMISSION_FLOOR"]) });
  const executable = addDecimal(floor.amountPerKg, commission);
  if (compareDecimalStrings(executable, buyerCeiling.value.value) > 0) throw new Error("pricing invariant exceeded buyer ceiling");
  return Object.freeze({ state: "EXECUTABLE", policyId: policy.policyId, policyVersion: policy.version, availableSurplusPerKg: surplus, commissionPerKg: commission, buyerExecutablePricePerKg: executable, currency: floor.currency });
}

export interface RelationshipValueFactors {
  readonly monthlyVolumeKg: EvidenceValue<DecimalString>;
  readonly expectedCommissionPerKg: EvidenceValue<DecimalString>;
  readonly expectedFillRate: EvidenceValue<DecimalString>;
  readonly expectedMonths: EvidenceValue<DecimalString>;
  readonly paymentProbability: EvidenceValue<DecimalString>;
  readonly operationalComplexity: EvidenceValue<DecimalString>;
}
export type RelationshipValue = Readonly<{ state: "KNOWN"; value: DecimalString; evidenceState: "HEURISTIC" | "CALIBRATED" }> | Readonly<{ state: "UNKNOWN"; reasons: readonly string[] }>;

export function expectedRelationshipValue(factors: RelationshipValueFactors, evidenceState: "HEURISTIC" | "CALIBRATED"): RelationshipValue {
  const entries = Object.entries(factors) as [keyof RelationshipValueFactors, EvidenceValue<DecimalString>][];
  const missing = entries.filter(([, value]) => value.state === "UNKNOWN").map(([key]) => `${String(key)}:UNKNOWN`);
  if (missing.length) return Object.freeze({ state: "UNKNOWN", reasons: Object.freeze(missing) });
  const known = Object.fromEntries(entries.map(([key, value]) => [key, value.state === "KNOWN" ? value.value : decimal("0")])) as unknown as Record<keyof RelationshipValueFactors, DecimalString>;
  if (compareDecimalStrings(known.operationalComplexity, decimal("0")) <= 0) return Object.freeze({ state: "UNKNOWN", reasons: Object.freeze(["operationalComplexity:NONPOSITIVE"]) });
  let numerator = multiplyDecimal(known.monthlyVolumeKg, known.expectedCommissionPerKg);
  numerator = multiplyDecimal(numerator, known.expectedFillRate);
  numerator = multiplyDecimal(numerator, known.expectedMonths);
  numerator = multiplyDecimal(numerator, known.paymentProbability);
  return Object.freeze({ state: "KNOWN", value: divideDecimal(numerator, known.operationalComplexity, 6), evidenceState });
}
