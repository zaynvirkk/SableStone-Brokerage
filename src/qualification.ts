import type { SupplierOffer, BuyerDemand } from "./domain.js";

export type QualificationVerdict = "PASS" | "FAIL" | "REQUEST_DOCUMENTS";
export interface QualificationResult {
  readonly verdict: QualificationVerdict;
  readonly reasons: readonly string[];
}

export interface RegistrationFact {
  readonly state: "VERIFIED" | "UNVERIFIED" | "EXPIRED" | "MISMATCH";
  readonly sourceReceiptId: string | null;
  readonly validUntil: string | null;
}

export interface DocumentFact {
  readonly kind: string;
  readonly documentId: string;
  readonly checkState: "VERIFIED" | "UNVERIFIED" | "EXPIRED" | "MISMATCH";
  readonly validUntil: string | null;
}

export interface SupplierQualificationInput {
  readonly offer: SupplierOffer;
  readonly registration: RegistrationFact;
  readonly documents: readonly DocumentFact[];
  readonly supplierConfirmedAt: string;
  readonly asksSableStoneToPrepay: boolean;
  readonly now: string;
  readonly requiredDocumentKinds: readonly string[];
}

export function qualifySupplier(input: SupplierQualificationInput): QualificationResult {
  const reasons: string[] = [];
  if (input.asksSableStoneToPrepay) reasons.push("SABLESTONE_PREPAY_FORBIDDEN");
  if (input.registration.state !== "VERIFIED" || !input.registration.sourceReceiptId) reasons.push("REGISTRATION_NOT_VERIFIED");
  if (!isCurrent(input.registration.validUntil, input.now)) reasons.push("REGISTRATION_EXPIRED_OR_UNKNOWN");
  if (input.offer.supplierNetPrice === "" || input.offer.supplierNetPrice.startsWith("-")) reasons.push("SUPPLIER_NET_REQUIRED");
  if (input.offer.freshnessState !== "CURRENT" || Date.parse(input.offer.expiresAt) <= Date.parse(input.now)) reasons.push("OFFER_NOT_CURRENT");
  if (Date.parse(input.supplierConfirmedAt) > Date.parse(input.now)) reasons.push("CONFIRMATION_TIME_INVALID");
  const missing = input.requiredDocumentKinds.filter((kind) => !input.documents.some((document) =>
    document.kind === kind && document.checkState === "VERIFIED" && isCurrent(document.validUntil, input.now)));
  if (reasons.length) return result("FAIL", [...reasons, ...missing.map((kind) => `DOCUMENT_REQUIRED:${kind}`)]);
  if (missing.length) return result("REQUEST_DOCUMENTS", missing.map((kind) => `DOCUMENT_REQUIRED:${kind}`));
  return result("PASS", []);
}

export type InventoryRefreshAction = "SAME" | "UPDATE_PRICE" | "UPDATE_STOCK" | "SOLD_OUT";
export interface InventoryRefresh {
  readonly previousOfferId: string;
  readonly previousVersion: number;
  readonly action: InventoryRefreshAction;
  readonly confirmedAt: string;
  readonly newSupplierNetPrice: string | null;
  readonly newQuantityMt: string | null;
}

export function applyInventoryRefresh(previous: SupplierOffer, refresh: InventoryRefresh, now: string): Readonly<{
  previousState: "OFFER_STALE" | "OFFER_DEAD";
  nextVersion: number | null;
  nextState: "OFFER_ACTIVE" | null;
}> {
  if (refresh.previousOfferId !== previous.offerId || refresh.previousVersion !== previous.version) throw new Error("refresh targets stale offer version");
  if (Date.parse(refresh.confirmedAt) > Date.parse(now)) throw new Error("refresh confirmation time invalid");
  if (refresh.action === "SOLD_OUT") return Object.freeze({ previousState: "OFFER_DEAD", nextVersion: null, nextState: null });
  if (refresh.action === "UPDATE_PRICE" && !refresh.newSupplierNetPrice) throw new Error("updated net price required");
  if (refresh.action === "UPDATE_STOCK" && !refresh.newQuantityMt) throw new Error("updated stock required");
  return Object.freeze({ previousState: "OFFER_STALE", nextVersion: previous.version + 1, nextState: "OFFER_ACTIVE" });
}

export interface BuyerQualificationInput {
  readonly demand: BuyerDemand;
  readonly registration: RegistrationFact;
  readonly buyerConfirmedAt: string;
  readonly asksSableStoneForCredit: boolean;
  readonly prohibitedUseClaim: boolean;
  readonly currentCeilingConfirmed: boolean;
  readonly now: string;
}

export function qualifyBuyer(input: BuyerQualificationInput): QualificationResult {
  const reasons: string[] = [];
  if (input.asksSableStoneForCredit) reasons.push("SABLESTONE_CREDIT_FORBIDDEN");
  if (input.prohibitedUseClaim) reasons.push("PROHIBITED_OR_UNSUPPORTED_USE");
  if (input.registration.state !== "VERIFIED" || !input.registration.sourceReceiptId || !isCurrent(input.registration.validUntil, input.now)) reasons.push("BUYER_REGISTRATION_NOT_CURRENT");
  if (input.demand.freshnessState !== "CURRENT" || Date.parse(input.demand.expiresAt) <= Date.parse(input.now)) reasons.push("DEMAND_NOT_CURRENT");
  if (input.demand.buyerCeiling.state === "KNOWN" && !input.currentCeilingConfirmed) reasons.push("BUYER_CEILING_NOT_CONFIRMED");
  if (input.demand.standing && input.demand.cadence.state === "UNKNOWN") reasons.push("STANDING_CADENCE_UNKNOWN");
  if (Date.parse(input.buyerConfirmedAt) > Date.parse(input.now)) reasons.push("CONFIRMATION_TIME_INVALID");
  return result(reasons.length ? "FAIL" : "PASS", reasons);
}

function isCurrent(validUntil: string | null, now: string): boolean {
  return validUntil !== null && Date.parse(validUntil) > Date.parse(now);
}
function result(verdict: QualificationVerdict, reasons: readonly string[]): QualificationResult {
  return Object.freeze({ verdict, reasons: Object.freeze([...reasons]) });
}
