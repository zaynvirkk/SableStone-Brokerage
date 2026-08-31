import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {AppendOnlyEventStore,TRADE_STATES,assertTradeTransition} from "../dist/index.js";

const contracts=[
 "discovery-contract.mjs","contact-contract.mjs","email-contract.mjs","extraction-contract.mjs","supplier-contract.mjs","buyer-contract.mjs","match-contract.mjs","cost-contract.mjs","pricing-contract.mjs","negotiation-contract.mjs","risk-contract.mjs","agreement-contract.mjs","vault-contract.mjs","settlement-capability-contract.mjs","router-contract.mjs","trade-contract.mjs","ledger-contract.mjs","recurring-contract.mjs","acquisition-contract.mjs","hardening-contract.mjs",
];
const receipts=[];
for(const file of contracts){const result=spawnSync(process.execPath,[`scripts/${file}`],{encoding:"utf8"});if(result.status!==0)throw new Error(`${file} failed: ${result.stderr}`);receipts.push(`${file}:${createHash("sha256").update(result.stdout).digest("hex")}`)}

const states=["MATCHED","NEGOTIATING","PROTECTED","FEE_LOCKED","IDENTITY_RELEASED","CONTRACTED","FUNDED","DISPATCHED","IN_TRANSIT","DELIVERED","ACCEPTED","SETTLED","RECURRING"];
const evidence={supplierAccepted:true,buyerAccepted:true,commissionLocked:true,settlementAvailable:true,identityReleased:true,supplierIsSeller:true,sablestoneHasCustody:false};
const store=new AppendOnlyEventStore();
for(let index=1;index<states.length;index++){
 const from=states[index-1],to=states[index];assertTradeTransition(from,to,evidence);
 store.append({eventId:`event-${index}`,idempotencyKey:`simulation-${index}`,aggregateType:"TRADE",aggregateId:"trade-synthetic-1",eventType:to,eventTime:`2026-08-31T00:${String(index).padStart(2,"0")}:00Z`,recordedTime:`2026-08-31T00:${String(index).padStart(2,"0")}:01Z`,policyVersion:"plan66-v1",payload:{fixture:true}});
}
let rejectionPaths=0;
for(const [from,to,bad] of [
 ["NEGOTIATING","PROTECTED",{...evidence,buyerAccepted:false}],
 ["PROTECTED","FEE_LOCKED",{...evidence,commissionLocked:false}],
 ["FEE_LOCKED","IDENTITY_RELEASED",{...evidence,settlementAvailable:false}],
 ["IDENTITY_RELEASED","CONTRACTED",{...evidence,supplierIsSeller:false}],
 ["FUNDED","DISPATCHED",{...evidence,sablestoneHasCustody:true}],
]){try{assertTradeTransition(from,to,bad)}catch{rejectionPaths++}}
if(rejectionPaths!==5)throw new Error("critical rejection path survived");
if(TRADE_STATES.some(state=>state.includes("FOUNDER")||state.includes("MANUAL")))throw new Error("manual state introduced");
const releaseDigest=createHash("sha256").update([...receipts,...store.list().map(event=>`${event.eventId}:${event.eventType}`)].join("\n")).digest("hex");
console.log(`FULL_SIMULATION_OK stages=${states.join(">")} contracts=${contracts.length} rejection_paths=${rejectionPaths} manual_steps=0 live_effects=0 digest=${releaseDigest}`);

