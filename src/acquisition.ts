import { known, unknown, type EvidenceValue } from "./domain.js";
import { decimal, divideDecimal, multiplyDecimal, type DecimalString } from "./money.js";

export interface FunnelStats { readonly segmentId:string;readonly emailsSent:number;readonly replies:number;readonly qualified:number;readonly matched:number;readonly settled:number;readonly totalRelationshipValue:EvidenceValue<DecimalString>;readonly outcomeReceiptIds:readonly string[];readonly windowStart:string;readonly windowEnd:string; }
export type ExpectedOutboundValue=Readonly<{state:"CALIBRATED";value:DecimalString;currency:string;sampleSize:number}>|Readonly<{state:"UNKNOWN"|"UNCALIBRATED";reasons:readonly string[]}>;
export function expectedValuePerOutbound(stats:FunnelStats,currency:string,minimumSample=30):ExpectedOutboundValue{
 const counts=[stats.emailsSent,stats.replies,stats.qualified,stats.matched,stats.settled];if(counts.some(v=>!Number.isSafeInteger(v)||v<0)||stats.replies>stats.emailsSent||stats.qualified>stats.replies||stats.matched>stats.qualified||stats.settled>stats.matched)return Object.freeze({state:"UNKNOWN",reasons:Object.freeze(["FUNNEL_COUNTS_INVALID"])});
 if(stats.emailsSent<minimumSample)return Object.freeze({state:"UNCALIBRATED",reasons:Object.freeze(["SAMPLE_BELOW_MINIMUM"])});
 if(stats.totalRelationshipValue.state==="UNKNOWN"||stats.outcomeReceiptIds.length<stats.settled)return Object.freeze({state:"UNKNOWN",reasons:Object.freeze(["OUTCOME_VALUE_OR_RECEIPTS_MISSING"])});
 if(!stats.emailsSent||!stats.replies||!stats.qualified||!stats.matched)return Object.freeze({state:"UNKNOWN",reasons:Object.freeze(["CONDITIONAL_DENOMINATOR_ZERO"])});
 const ratio=(a:number,b:number)=>divideDecimal(decimal(String(a)),decimal(String(b)),8);
 let probability=ratio(stats.replies,stats.emailsSent);probability=multiplyDecimal(probability,ratio(stats.qualified,stats.replies));probability=multiplyDecimal(probability,ratio(stats.matched,stats.qualified));probability=multiplyDecimal(probability,ratio(stats.settled,stats.matched));
 const averageLtv=stats.settled?divideDecimal(stats.totalRelationshipValue.value,decimal(String(stats.settled)),6):decimal("0");
 return Object.freeze({state:"CALIBRATED",value:multiplyDecimal(probability,averageLtv),currency,sampleSize:stats.emailsSent});
}
export interface AcquisitionCandidate {readonly candidateId:string;readonly segmentId:string;readonly verifiedContactId:string;readonly executableMatchId:string|null;readonly freshOffer:boolean;readonly marginKnownPositive:boolean;readonly suppressionClear:boolean;readonly jurisdictionPolicyCurrent:boolean;}
export interface AcquisitionPlanItem {readonly candidateId:string;readonly executableMatchId:string;readonly mode:"SANDBOX_PLAN_ONLY";readonly reason:"EXECUTABLE_INVENTORY_AND_POLICY";}
export function scheduleAcquisition(candidates:readonly AcquisitionCandidate[],limit:number):readonly AcquisitionPlanItem[]{
 if(!Number.isSafeInteger(limit)||limit<0)throw new Error("acquisition limit invalid");return Object.freeze(candidates.filter(c=>c.executableMatchId&&c.freshOffer&&c.marginKnownPositive&&c.suppressionClear&&c.jurisdictionPolicyCurrent).slice(0,limit).map(c=>Object.freeze({candidateId:c.candidateId,executableMatchId:c.executableMatchId as string,mode:"SANDBOX_PLAN_ONLY" as const,reason:"EXECUTABLE_INVENTORY_AND_POLICY" as const})));
}
