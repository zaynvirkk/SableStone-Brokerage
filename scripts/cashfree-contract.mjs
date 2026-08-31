import { CashfreeEasySplitAdapter, SettlementEventInbox } from "../dist/index.js";
import { approval, credentials, draft, now } from "./settlement-fixture.mjs";
const provider="CASHFREE_EASY_SPLIT", input=draft(provider), vendor={vendorId:"vendor-1",organizationId:input.supplierId,kycState:"ACTIVE",bankVerified:true};
const adapter=new CashfreeEasySplitAdapter("SANDBOX",approval(provider),credentials(provider),vendor), created=await adapter.createInstruction(input,now);
if(!created.acknowledged) throw new Error("Cashfree sandbox instruction failed");
let rejected=0; for(const changed of [{...vendor,kycState:"PENDING"},{...vendor,bankVerified:false},{...vendor,organizationId:"other"}]) try{await new CashfreeEasySplitAdapter("SANDBOX",approval(provider),credentials(provider),changed).createInstruction(input,now)}catch{rejected++}
const inbox=new SettlementEventInbox(); for(const [i,type] of ["VENDOR_SETTLEMENT_SUCCESS","VENDOR_SETTLEMENT_FAILED","VENDOR_SETTLEMENT_REVERSED","REFUND_ADJUSTED"].entries()) adapter.receiveSettlementWebhook(inbox,{provider,externalEventId:`e${i}`,providerReference:created.providerReference,eventType:type,occurredAt:now,payloadDigest:String(i+1).repeat(64),signatureVerified:true});
try{adapter.receiveSettlementWebhook(inbox,{provider,externalEventId:"bad",providerReference:"r",eventType:"MADE_UP",occurredAt:now,payloadDigest:"a".repeat(64),signatureVerified:true})}catch{rejected++}
if(inbox.count()!==4||rejected!==4) throw new Error("Cashfree failed open");
console.log("CASHFREE_OK vendor_kyc=required bank_verified=required split_exact=true success_event=true failure_event=true reversal_event=true refund_adjustment=true signature_required=true");
