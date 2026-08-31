import {proxyActivities,sleep} from "@temporalio/workflow";

export interface WorkflowReceipt{readonly receiptId:string;readonly digest:string;readonly state:"ACCEPTED"|"REJECTED"|"UNKNOWN";}
export interface BrokerageActivities{
 discoverSupplier(input:{sourceId:string;cursor:string|null}):Promise<WorkflowReceipt>;
 discoverBuyer(input:{sourceId:string;cursor:string|null}):Promise<WorkflowReceipt>;
 qualify(input:{organizationId:string;role:"SUPPLIER"|"BUYER"}):Promise<WorkflowReceipt>;
 match(input:{offerId:string;demandId:string}):Promise<WorkflowReceipt>;
 negotiate(input:{matchId:string;round:number}):Promise<WorkflowReceipt>;
 protect(input:{matchId:string}):Promise<WorkflowReceipt>;
 lockSettlement(input:{tradeId:string;provider:string}):Promise<WorkflowReceipt>;
 releaseIdentity(input:{tradeId:string;feeLockReceiptId:string}):Promise<WorkflowReceipt>;
 monitorShipment(input:{tradeId:string}):Promise<WorkflowReceipt>;
 reconcile(input:{tradeId:string}):Promise<WorkflowReceipt>;
 recur(input:{tradeId:string}):Promise<WorkflowReceipt>;
}
const activities=proxyActivities<BrokerageActivities>({startToCloseTimeout:"2 minutes",scheduleToCloseTimeout:"10 minutes",retry:{maximumAttempts:5,initialInterval:"2 seconds",maximumInterval:"1 minute",backoffCoefficient:2}});
function accepted(receipt:WorkflowReceipt,label:string):WorkflowReceipt{if(receipt.state!=="ACCEPTED")throw new Error(`${label} failed closed: ${receipt.state}`);return receipt;}
export async function SupplierDiscoveryWorkflow(input:{sourceId:string;cursor:string|null}):Promise<WorkflowReceipt>{return activities.discoverSupplier(input)}
export async function BuyerDiscoveryWorkflow(input:{sourceId:string;cursor:string|null}):Promise<WorkflowReceipt>{return activities.discoverBuyer(input)}
export async function QualificationWorkflow(input:{organizationId:string;role:"SUPPLIER"|"BUYER"}):Promise<WorkflowReceipt>{return activities.qualify(input)}
export async function MatchWorkflow(input:{offerId:string;demandId:string}):Promise<WorkflowReceipt>{return activities.match(input)}
export async function NegotiationWorkflow(input:{matchId:string;maximumRounds:number}):Promise<WorkflowReceipt>{for(let round=1;round<=input.maximumRounds;round++){const result=await activities.negotiate({matchId:input.matchId,round});if(result.state==="ACCEPTED"||result.state==="REJECTED")return result;await sleep("1 hour")}throw new Error("negotiation expired")}
export async function ProtectedRelationshipWorkflow(input:{matchId:string}):Promise<WorkflowReceipt>{return activities.protect(input)}
export async function SettlementWorkflow(input:{tradeId:string;provider:string}):Promise<readonly WorkflowReceipt[]>{let lock:WorkflowReceipt|undefined;for(let attempt=0;attempt<168;attempt++){const result=await activities.lockSettlement(input);if(result.state==="REJECTED")throw new Error("fee lock rejected");if(result.state==="ACCEPTED"){lock=result;break}await sleep("1 hour")}if(!lock)throw new Error("fee lock expired");let release:WorkflowReceipt|undefined;for(let attempt=0;attempt<24;attempt++){const result=await activities.releaseIdentity({tradeId:input.tradeId,feeLockReceiptId:lock.receiptId});if(result.state==="REJECTED")throw new Error("identity release rejected");if(result.state==="ACCEPTED"){release=result;break}await sleep("5 minutes")}if(!release)throw new Error("identity release unavailable");return Object.freeze([lock,release])}
export async function ShipmentWorkflow(input:{tradeId:string}):Promise<WorkflowReceipt>{return activities.monitorShipment(input)}
export async function RecurringDemandWorkflow(input:{tradeId:string}):Promise<readonly WorkflowReceipt[]>{let reconciled:WorkflowReceipt|undefined;for(let attempt=0;attempt<30*24;attempt++){const result=await activities.reconcile(input);if(result.state==="REJECTED")throw new Error("reconciliation mismatch");if(result.state==="ACCEPTED"){reconciled=result;break}await sleep("1 hour")}if(!reconciled)throw new Error("reconciliation expired");let recurring:WorkflowReceipt|undefined;for(let attempt=0;attempt<30;attempt++){const result=await activities.recur(input);if(result.state==="REJECTED")throw new Error("recurrence rejected");if(result.state==="ACCEPTED"){recurring=result;break}await sleep("1 day")}if(!recurring)throw new Error("recurrence unavailable");return Object.freeze([reconciled,recurring])}
