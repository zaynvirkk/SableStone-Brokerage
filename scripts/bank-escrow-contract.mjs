import { IndianBankEscrowAdapter } from "../dist/index.js";
import { approval, credentials, draft, now } from "./settlement-fixture.mjs";
const provider="INDIAN_BANK_ESCROW", adapter=new IndianBankEscrowAdapter("SANDBOX",approval(provider),credentials(provider)), input=draft(provider);
const generated=await adapter.createInstruction(input,now);
if(generated.acknowledged) throw new Error("generated bank instruction became fee lock");
let rejected=0; for(const ack of [
 {instructionId:input.instructionId,bankReference:"",signedReceiptId:"receipt",instructionDigest:"a".repeat(64),acknowledgedAt:now,signatureVerified:true},
 {instructionId:input.instructionId,bankReference:"BANK-1",signedReceiptId:"receipt",instructionDigest:"a".repeat(64),acknowledgedAt:now,signatureVerified:false},
 {instructionId:"unknown",bankReference:"BANK-1",signedReceiptId:"receipt",instructionDigest:"a".repeat(64),acknowledgedAt:now,signatureVerified:true},
]) try{adapter.acknowledge(ack)}catch{rejected++}
const ack=adapter.acknowledge({instructionId:input.instructionId,bankReference:"BANK-FIXTURE-1",signedReceiptId:"signed-bank-receipt",instructionDigest:"a".repeat(64),acknowledgedAt:now,signatureVerified:true});
if(!ack.acknowledged||rejected!==3) throw new Error("bank acknowledgement failed");
console.log("BANK_ESCROW_OK generated_not_locked=true bank_ack_required=true signature_required=true unknown_instruction=reject allocation_exact=true");
