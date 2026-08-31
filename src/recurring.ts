import type { BuyerDemand, SupplierOffer } from "./domain.js";
import type { FeeLock } from "./router.js";
import type { ProtectedRelationship } from "./vault.js";

export interface StandingDemandAuthorization {
  readonly demandId: string; readonly demandVersion: number; readonly automaticRenewalPermitted: boolean;
  readonly maximumRenewals: number; readonly renewalsUsed: number; readonly confirmedAt: string; readonly validUntil: string;
  readonly acceptanceDigest: string;
}
export interface RecurringCandidate { readonly relationshipId: string;readonly priorFeeLockId:string;readonly offerId:string;readonly offerVersion:number;readonly demandId:string;readonly demandVersion:number;readonly status:"MATCHED_REQUIRES_NEW_FEE_LOCK"; }
export function createRecurringCandidate(relationship:ProtectedRelationship,priorLock:FeeLock,offer:SupplierOffer,demand:BuyerDemand,authorization:StandingDemandAuthorization,now:string):RecurringCandidate{
 if(priorLock.relationshipId!==relationship.relationshipId||priorLock.state!=="LOCKED")throw new Error("prior protected fee lock required");
 if(Date.parse(relationship.protectedUntil)<=Date.parse(now))throw new Error("protected relationship expired");
 if(!demand.standing||authorization.demandId!==demand.demandId||authorization.demandVersion!==demand.version||!authorization.automaticRenewalPermitted)throw new Error("current standing demand authorization required");
 if(authorization.renewalsUsed>=authorization.maximumRenewals||Date.parse(authorization.validUntil)<=Date.parse(now)||!(/^[0-9a-f]{64}$/.test(authorization.acceptanceDigest)))throw new Error("standing demand authorization expired or exhausted");
 if(offer.freshnessState!=="CURRENT"||demand.freshnessState!=="CURRENT"||Date.parse(offer.expiresAt)<=Date.parse(now)||Date.parse(demand.expiresAt)<=Date.parse(now))throw new Error("fresh offer and demand required");
 if(!relationship.commodityScope.includes(offer.product.family)||offer.product.family!==demand.product.family)throw new Error("recurrence outside protected commodity scope");
 return Object.freeze({relationshipId:relationship.relationshipId,priorFeeLockId:priorLock.feeLockId,offerId:offer.offerId,offerVersion:offer.version,demandId:demand.demandId,demandVersion:demand.version,status:"MATCHED_REQUIRES_NEW_FEE_LOCK"});
}
export interface ObservedPurchase {readonly supplierId:string;readonly buyerId:string;readonly commodityFamily:string;readonly purchasedAt:string;readonly directOrIndirect:"DIRECT"|"AFFILIATE"|"INDIRECT";readonly sourceReceiptId:string;}
export function qualifyingProtectedPurchase(relationship:ProtectedRelationship,purchase:ObservedPurchase):boolean{
 return purchase.supplierId===relationship.supplierId&&purchase.buyerId===relationship.buyerId&&relationship.commodityScope.includes(purchase.commodityFamily)&&Date.parse(purchase.purchasedAt)>=Date.parse(relationship.introducedAt)&&Date.parse(purchase.purchasedAt)<Date.parse(relationship.protectedUntil)&&Boolean(purchase.sourceReceiptId)&&["DIRECT","AFFILIATE","INDIRECT"].includes(purchase.directOrIndirect);
}
