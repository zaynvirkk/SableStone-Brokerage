import { LcProceedsAdapter } from "../dist/index.js";
import { approval, credentials, draft, now } from "./settlement-fixture.mjs";
const provider="LC_PROCEEDS",adapter=new LcProceedsAdapter("SANDBOX",approval(provider),credentials(provider)),input=draft(provider,"USD"),generated=await adapter.createInstruction(input,now);
if(generated.acknowledged) throw new Error("assignment document alone became fee lock"); let rejected=0;
for(const ack of [
 {instructionId:input.instructionId,issuingOrNominatedBank:"",acknowledgementReceiptId:"r",applicableLawReviewReceiptId:"law",assignmentDigest:"a".repeat(64),signatureVerified:true},
 {instructionId:input.instructionId,issuingOrNominatedBank:"Fixture Bank",acknowledgementReceiptId:"r",applicableLawReviewReceiptId:"",assignmentDigest:"a".repeat(64),signatureVerified:true},
 {instructionId:input.instructionId,issuingOrNominatedBank:"Fixture Bank",acknowledgementReceiptId:"r",applicableLawReviewReceiptId:"law",assignmentDigest:"a".repeat(64),signatureVerified:false},
]) try{adapter.acknowledge(ack)}catch{rejected++}
const ack=adapter.acknowledge({instructionId:input.instructionId,issuingOrNominatedBank:"Fixture Bank",acknowledgementReceiptId:"bank-ack",applicableLawReviewReceiptId:"law-review",assignmentDigest:"a".repeat(64),signatureVerified:true});
if(!ack.acknowledged||rejected!==3) throw new Error("LC ack failed");
console.log("LC_OK assignment_alone=not_locked bank_ack=required applicable_law=required signature=required partial_proceeds=true");
