import { compareDecimalStrings, type BuyerDemand, type NumericRange, type Quantity, type SupplierOffer } from "./domain.js";
import { decimal, type DecimalString } from "./money.js";

export type MatchRejectionReason =
  | "PRODUCT_FAMILY_MISMATCH" | "POLYMER_MISMATCH" | "APPLICATION_UNKNOWN"
  | "APPLICATION_MISMATCH" | "SPEC_PROPERTY_MISSING" | "SPEC_UNIT_MISMATCH"
  | "SPEC_INTERVAL_DISJOINT" | "QUANTITY_UNAVAILABLE" | "BELOW_MOQ"
  | "OFFER_NOT_CURRENT" | "DEMAND_NOT_CURRENT" | "DELIVERY_DATE_MISFIT"
  | "DESTINATION_UNSUPPORTED" | "DOCUMENT_REQUIREMENT_UNMET"
  | "SUPPLIER_NOT_ELIGIBLE" | "BUYER_NOT_ELIGIBLE" | "SETTLEMENT_UNAVAILABLE"
  | "RISK_GATE_FAILED" | "SUBSTITUTION_FORBIDDEN";

export interface MatchContext {
  readonly now: string;
  readonly supplierEligible: boolean;
  readonly buyerEligible: boolean;
  readonly settlementAvailable: boolean;
  readonly riskPass: boolean;
  readonly destinationSupported: boolean;
  readonly requiredDocumentsPresent: boolean;
  readonly substitutionPermitted: boolean;
  readonly earliestDeliveryAt: string;
}
export interface CompatibilityResult {
  readonly compatible: boolean;
  readonly reasons: readonly MatchRejectionReason[];
  readonly offerId: string;
  readonly offerVersion: number;
  readonly demandId: string;
  readonly demandVersion: number;
}

export function matchOfferDemand(offer: SupplierOffer, demand: BuyerDemand, context: MatchContext): CompatibilityResult {
  const reasons: MatchRejectionReason[] = [];
  if (offer.product.family !== demand.product.family) reasons.push("PRODUCT_FAMILY_MISMATCH");
  if (offer.product.polymer !== demand.product.polymer) reasons.push("POLYMER_MISMATCH");
  if (offer.product.application.state === "UNKNOWN" || demand.product.application.state === "UNKNOWN") reasons.push("APPLICATION_UNKNOWN");
  else if (normalized(offer.product.application.value) !== normalized(demand.product.application.value)) reasons.push("APPLICATION_MISMATCH");
  if (!context.substitutionPermitted && (offer.product.grade.state === "UNKNOWN" || demand.product.grade.state === "UNKNOWN" ||
      normalized(offer.product.grade.value) !== normalized(demand.product.grade.value))) reasons.push("SUBSTITUTION_FORBIDDEN");
  compareSpecifications(offer.product.properties, demand.product.properties, reasons);
  if (compareQuantities(offer.available, demand.quantity) < 0) reasons.push("QUANTITY_UNAVAILABLE");
  if (compareQuantities(demand.quantity, offer.moq) < 0) reasons.push("BELOW_MOQ");
  if (offer.freshnessState !== "CURRENT" || Date.parse(offer.expiresAt) <= Date.parse(context.now)) reasons.push("OFFER_NOT_CURRENT");
  if (demand.freshnessState !== "CURRENT" || Date.parse(demand.expiresAt) <= Date.parse(context.now)) reasons.push("DEMAND_NOT_CURRENT");
  if (Date.parse(context.earliestDeliveryAt) > Date.parse(demand.requiredAt)) reasons.push("DELIVERY_DATE_MISFIT");
  if (!context.destinationSupported) reasons.push("DESTINATION_UNSUPPORTED");
  if (!context.requiredDocumentsPresent) reasons.push("DOCUMENT_REQUIREMENT_UNMET");
  if (!context.supplierEligible) reasons.push("SUPPLIER_NOT_ELIGIBLE");
  if (!context.buyerEligible) reasons.push("BUYER_NOT_ELIGIBLE");
  if (!context.settlementAvailable) reasons.push("SETTLEMENT_UNAVAILABLE");
  if (!context.riskPass) reasons.push("RISK_GATE_FAILED");
  return Object.freeze({ compatible: reasons.length === 0, reasons: Object.freeze([...new Set(reasons)]), offerId: offer.offerId, offerVersion: offer.version, demandId: demand.demandId, demandVersion: demand.version });
}

function compareSpecifications(offer: readonly NumericRange[], demand: readonly NumericRange[], reasons: MatchRejectionReason[]): void {
  for (const required of demand) {
    const sameProperty = offer.filter((candidate) => normalized(candidate.property) === normalized(required.property));
    if (!sameProperty.length) { reasons.push("SPEC_PROPERTY_MISSING"); continue; }
    const sameUnit = sameProperty.find((candidate) => normalized(candidate.unit) === normalized(required.unit));
    if (!sameUnit) { reasons.push("SPEC_UNIT_MISMATCH"); continue; }
    if (compareDecimalStrings(sameUnit.maximum, required.minimum) < 0 || compareDecimalStrings(sameUnit.minimum, required.maximum) > 0) reasons.push("SPEC_INTERVAL_DISJOINT");
  }
}

function compareQuantities(left: Quantity, right: Quantity): number {
  return compareDecimalStrings(quantityKg(left), quantityKg(right));
}
function quantityKg(quantity: Quantity): DecimalString {
  if (quantity.unit === "KG") return quantity.value;
  const [whole, fraction = ""] = quantity.value.split(".");
  const atoms = BigInt((whole ?? "0") + fraction) * 1000n;
  const scale = fraction.length;
  const raw = atoms.toString().padStart(scale + 1, "0");
  return decimal(scale ? `${raw.slice(0, -scale)}.${raw.slice(-scale)}` : raw);
}
function normalized(value: string): string { return value.trim().toLocaleLowerCase("en-IN").replace(/\s+/g, " "); }
