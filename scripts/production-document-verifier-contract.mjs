import { createHash } from "node:crypto";
import { ProductionDocumentVerifier, buildProductionSettlementAdapters } from "../dist/index.js";

const receipts=[];
const store={async preserve(prefix,body,contentType,source){const sha256=createHash("sha256").update(body).digest("hex"),receipt={objectKey:`${prefix}/${sha256}`,sha256,bytes:body.byteLength,contentType,storedAt:new Date().toISOString(),source};receipts.push(receipt);return receipt}};
const extraction={kind:"COA",extractor:"source-extractor",modelVersion:"1",facts:[{field:"mfi",value:"12",unit:"g/10min",confidence:"0.970000",state:"SOURCE_STATED",sourceReceiptId:"documents/raw/"+"a".repeat(64)}]};
const config={provider:"INDEPENDENT_LAB",baseUrl:"https://lab.example.test",verificationPath:"/verify",authorizationHeader:"Bearer scoped",approvalReceiptId:"lab-approval",validUntil:"2026-12-01T00:00:00Z",policyVersion:"lab-v1"};
const verifier=new ProductionDocumentVerifier(config,store,async()=>new Response(JSON.stringify({externalReference:"lab-1",documentKind:"COA",independentlyVerified:true,checks:[{checkType:"SPEC_AUTHENTICITY",state:"VERIFIED",validUntil:"2026-10-01T00:00:00Z"}]}),{status:200,headers:{"content-type":"application/json"}}));
const result=await verifier.verify({bytes:new TextEncoder().encode("verified document"),sha256:"b".repeat(64),extraction,documentId:"document-1"});
if(result.checks[0]?.state!=="VERIFIED"||receipts.length!==2)throw new Error("independent verification receipt path failed");

let blocked=false;
try{await new ProductionDocumentVerifier(config,store,async()=>new Response(JSON.stringify({externalReference:"lab-2",documentKind:"COA",independentlyVerified:false,checks:[{checkType:"SPEC_AUTHENTICITY",state:"VERIFIED",validUntil:null}]}),{status:200})).verify({bytes:new Uint8Array([1]),sha256:"c".repeat(64),extraction,documentId:"document-2"})}catch{blocked=true}
if(!blocked)throw new Error("self-stated document verification survived");

blocked=false;
try{await buildProductionSettlementAdapters({query(){throw new Error("database should not be reached")}},store,JSON.stringify([{provider:"UNKNOWN_RAIL",baseUrl:"https://rail.example.test",createPath:"/create",authorizationHeader:"Bearer x",additionalHeaders:{},webhookSecret:"secret",responseReferenceField:"id",responseAcknowledgedField:"ack",credentialSecretReference:"secret/ref",credentialVerifiedAt:new Date().toISOString()}]))}catch(error){blocked=String(error.message).includes("unsupported production settlement provider")}
if(!blocked)throw new Error("unknown settlement rail received fallback request builder");

console.log("PRODUCTION_DOCUMENT_VERIFIER_CONTRACT_OK verified=independent self_stated=blocked unknown_rail=blocked");
