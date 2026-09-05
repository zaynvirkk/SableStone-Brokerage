import type { BuyerDemand, SupplierOffer } from "./domain.js";
import type { FeeLock } from "./router.js";
import type { ProtectedRelationship } from "./vault.js";

export interface StandingDemandAuthorization {
  readonly demandId: string; readonly demandVersion: number; readonly automaticRenewalPermitted: boolean;
  readonly maximumRenewals: number; readonly renewalsConsumed:number;readonly renewalsReserved:number; readonly confirmedAt: string; readonly validUntil: string;
  readonly buyerId:string;readonly productFamily:string;readonly productSpec:Readonly<Record<string,unknown>>;readonly cadenceDays:number;readonly nextRequiredAt:string;readonly quantityPerCycleMt:string;readonly quantityToleranceMt:string;readonly maximumAllInPricePerKg:string;readonly currency:string;readonly supplierScope:"SAME_SUPPLIER"|"APPROVED_SUBSTITUTION";
  readonly acceptanceDigest: string;
}
export type RecurringCandidateStatus="ECONOMICS_PENDING"|"PRICE_APPROVAL_REQUIRED"|"PRICE_APPROVED"|"TRADE_PROTECTED"|"FEE_LOCKED"|"DECLINED"|"FAILED"|"EXPIRED";
export type RenewalReservationState="AVAILABLE"|"RESERVED"|"COMMITTED"|"CONSUMED"|"RELEASED";

/**
 * Canonical domain projection of the production recurrence tables.  A
 * reservation is deliberately separate from a candidate status: RESERVED is
 * temporary quote capacity, COMMITTED is bound to one concrete trade and
 * snapshot, and only a secured entitlement may make it CONSUMED.
 */
export interface RecurringCandidate {
  readonly relationshipId: string;
  readonly priorFeeLockId:string;
  readonly offerId:string;
  readonly offerVersion:number;
  readonly authorizationDemandId:string;
  readonly authorizationDemandVersion:number;
  readonly executionDemandId:string|null;
  readonly executionDemandVersion:number|null;
  readonly reservationId:string|null;
  readonly reservationState:RenewalReservationState;
  readonly tradeId:string|null;
  readonly finalEconomicsSnapshotId:string|null;
  readonly status:RecurringCandidateStatus;
}
export function createRecurringCandidate(relationship:ProtectedRelationship,priorLock:FeeLock,offer:SupplierOffer,demand:BuyerDemand,authorization:StandingDemandAuthorization,now:string):RecurringCandidate{
 if(priorLock.relationshipId!==relationship.relationshipId||priorLock.state!=="LOCKED")throw new Error("prior protected fee lock required");
 if(Date.parse(relationship.protectedUntil)<=Date.parse(now))throw new Error("protected relationship expired");
 if(!demand.standing||authorization.demandId!==demand.demandId||authorization.demandVersion!==demand.version||!authorization.automaticRenewalPermitted)throw new Error("current standing demand authorization required");
 if(authorization.renewalsConsumed+authorization.renewalsReserved>=authorization.maximumRenewals||Date.parse(authorization.validUntil)<=Date.parse(now)||Date.parse(authorization.nextRequiredAt)>Date.parse(now)||!(/^[0-9a-f]{64}$/.test(authorization.acceptanceDigest)))throw new Error("standing demand authorization unavailable, not due, or exhausted");
 if(offer.freshnessState!=="CURRENT"||demand.freshnessState!=="CURRENT"||Date.parse(offer.expiresAt)<=Date.parse(now)||Date.parse(demand.expiresAt)<=Date.parse(now))throw new Error("fresh offer and demand required");
 if(!relationship.commodityScope.includes(offer.product.family)||offer.product.family!==demand.product.family)throw new Error("recurrence outside protected commodity scope");
 return Object.freeze({relationshipId:relationship.relationshipId,priorFeeLockId:priorLock.feeLockId,offerId:offer.offerId,offerVersion:offer.version,authorizationDemandId:authorization.demandId,authorizationDemandVersion:authorization.demandVersion,executionDemandId:null,executionDemandVersion:null,reservationId:null,reservationState:"RESERVED" as const,tradeId:null,finalEconomicsSnapshotId:null,status:"ECONOMICS_PENDING" as const});
}
export interface ObservedPurchase {readonly supplierId:string;readonly buyerId:string;readonly commodityFamily:string;readonly purchasedAt:string;readonly directOrIndirect:"DIRECT"|"AFFILIATE"|"INDIRECT";readonly sourceReceiptId:string;}
export function qualifyingProtectedPurchase(relationship:ProtectedRelationship,purchase:ObservedPurchase):boolean{
 return purchase.supplierId===relationship.supplierId&&purchase.buyerId===relationship.buyerId&&relationship.commodityScope.includes(purchase.commodityFamily)&&Date.parse(purchase.purchasedAt)>=Date.parse(relationship.introducedAt)&&Date.parse(purchase.purchasedAt)<Date.parse(relationship.protectedUntil)&&Boolean(purchase.sourceReceiptId)&&["DIRECT","AFFILIATE","INDIRECT"].includes(purchase.directOrIndirect);
}
