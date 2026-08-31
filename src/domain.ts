import { decimal, type DecimalString } from "./money.js";

export const PRODUCT_FAMILIES = [
  "RPP_NATURAL_LIGHT_INJECTION",
  "RPP_COLOURED_BLACK_INJECTION",
  "RHDPE_NATURAL_BLOW_INJECTION",
  "RHDPE_COLOURED_BLACK_BLOW_INJECTION",
  "RLLDPE_LDPE_FILM",
  "PP_PRIME_NON_PRIME",
  "HDPE_PRIME_NON_PRIME",
  "LLDPE_PRIME_NON_PRIME",
] as const;

export type ProductFamily = (typeof PRODUCT_FAMILIES)[number];
export type EvidenceValue<T> =
  | Readonly<{ state: "KNOWN"; value: T; sourceDocumentId: string }>
  | Readonly<{ state: "UNKNOWN" }>;

export interface Quantity {
  readonly value: DecimalString;
  readonly unit: "MT" | "KG";
}

export interface NumericRange {
  readonly property: string;
  readonly minimum: DecimalString;
  readonly maximum: DecimalString;
  readonly unit: string;
}

export interface ProductSpec {
  readonly family: ProductFamily;
  readonly polymer: "PP" | "HDPE" | "LLDPE" | "LDPE";
  readonly materialClass: "RECYCLED" | "PRIME" | "NON_PRIME" | "OFF_GRADE";
  readonly recycledSource: EvidenceValue<"PCR" | "PIR">;
  readonly grade: EvidenceValue<string>;
  readonly application: EvidenceValue<string>;
  readonly properties: readonly NumericRange[];
}

export interface SupplierOffer {
  readonly offerId: string;
  readonly supplierId: string;
  readonly sourceEventId: string;
  readonly version: number;
  readonly supersedesOfferId: string | null;
  readonly product: ProductSpec;
  readonly available: Quantity;
  readonly monthlyCapacity: EvidenceValue<Quantity>;
  readonly moq: Quantity;
  readonly supplierNetPrice: DecimalString;
  readonly currency: string;
  readonly priceBasis: string;
  readonly incoterm: string;
  readonly dispatchLocation: string;
  readonly leadTimeDays: number;
  readonly documentIds: readonly string[];
  readonly expiresAt: string;
  readonly verificationState: "DRAFT" | "VERIFIED" | "REJECTED";
  readonly freshnessState: "CURRENT" | "STALE" | "EXPIRED";
}

export interface BuyerDemand {
  readonly demandId: string;
  readonly buyerId: string;
  readonly sourceEventId: string;
  readonly version: number;
  readonly product: ProductSpec;
  readonly quantity: Quantity;
  readonly destination: string;
  readonly buyerCeiling: EvidenceValue<Readonly<{ value: DecimalString; currency: string }>>;
  readonly requiredDocumentKinds: readonly string[];
  readonly requiredAt: string;
  readonly expiresAt: string;
  readonly cadence: EvidenceValue<string>;
  readonly standing: boolean;
  readonly verificationState: "DRAFT" | "VERIFIED" | "REJECTED";
  readonly freshnessState: "CURRENT" | "STALE" | "EXPIRED";
}

export function unknown<T>(): EvidenceValue<T> {
  return Object.freeze({ state: "UNKNOWN" });
}

export function known<T>(value: T, sourceDocumentId: string): EvidenceValue<T> {
  if (sourceDocumentId.trim() === "") throw new Error("known value requires source document");
  return Object.freeze({ state: "KNOWN", value, sourceDocumentId });
}

export function quantity(value: string, unit: Quantity["unit"]): Quantity {
  const parsed = decimal(value);
  if (parsed.startsWith("-")) throw new Error("quantity must be nonnegative");
  return Object.freeze({ value: parsed, unit });
}

export function numericRange(property: string, minimum: string, maximum: string, unit: string): NumericRange {
  if (!property.trim() || !unit.trim()) throw new Error("range requires property and unit");
  const min = decimal(minimum);
  const max = decimal(maximum);
  if (compareDecimalStrings(min, max) > 0) throw new Error("range minimum exceeds maximum");
  return Object.freeze({ property, minimum: min, maximum: max, unit });
}

function scaled(value: DecimalString, scale: number): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const atoms = BigInt(whole + fraction.padEnd(scale, "0"));
  return negative ? -atoms : atoms;
}

export function compareDecimalStrings(left: DecimalString, right: DecimalString): number {
  const leftFraction = left.split(".")[1]?.length ?? 0;
  const rightFraction = right.split(".")[1]?.length ?? 0;
  const scale = Math.max(leftFraction, rightFraction);
  const l = scaled(left, scale);
  const r = scaled(right, scale);
  return l < r ? -1 : l > r ? 1 : 0;
}

export function assertProductSpec(spec: ProductSpec): void {
  if (!PRODUCT_FAMILIES.includes(spec.family)) throw new Error("unsupported product family");
  const seen = new Set<string>();
  for (const property of spec.properties) {
    const key = `${property.property}:${property.unit}`;
    if (seen.has(key)) throw new Error(`duplicate property and unit: ${key}`);
    seen.add(key);
    if (compareDecimalStrings(property.minimum, property.maximum) > 0) {
      throw new Error("invalid property interval");
    }
  }
}

export function assertOffer(offer: SupplierOffer): void {
  assertProductSpec(offer.product);
  if (offer.version < 1 || !Number.isSafeInteger(offer.version)) throw new Error("invalid offer version");
  if (!/^[A-Z]{3}$/.test(offer.currency)) throw new Error("currency must be ISO-4217 alpha-3");
  if (offer.leadTimeDays < 0 || !Number.isSafeInteger(offer.leadTimeDays)) throw new Error("invalid lead time");
  if (compareDecimalStrings(offer.supplierNetPrice, decimal("0")) < 0) throw new Error("negative price");
  if (offer.verificationState === "VERIFIED" && offer.documentIds.length === 0) {
    throw new Error("verified offer requires documents");
  }
}

export function assertDemand(demand: BuyerDemand): void {
  assertProductSpec(demand.product);
  if (demand.version < 1 || !Number.isSafeInteger(demand.version)) throw new Error("invalid demand version");
  if (demand.buyerCeiling.state === "KNOWN") {
    if (!/^[A-Z]{3}$/.test(demand.buyerCeiling.value.currency)) throw new Error("invalid ceiling currency");
    if (compareDecimalStrings(demand.buyerCeiling.value.value, decimal("0")) < 0) throw new Error("negative ceiling");
  }
}
