import { createHash } from "node:crypto";

export interface BackupObject { readonly key:string;readonly sha256:string;readonly bytes:number; }
export interface BackupManifest { readonly backupId:string;readonly createdAt:string;readonly encrypted:boolean;readonly objects:readonly BackupObject[];readonly manifestSha256:string; }
function digestObjects(objects:readonly BackupObject[]):string{return createHash("sha256").update(JSON.stringify([...objects].sort((a,b)=>a.key.localeCompare(b.key)))).digest("hex");}
export function createBackupManifest(backupId:string,createdAt:string,encrypted:boolean,objects:readonly BackupObject[]):BackupManifest{
 if(!backupId.trim()||!encrypted||!objects.length)throw new Error("encrypted non-empty backup required");
 for(const object of objects)if(!object.key.trim()||object.bytes<0||!/^[0-9a-f]{64}$/.test(object.sha256))throw new Error("backup object invalid");
 const stored=objects.map(object=>Object.freeze({...object}));
 return Object.freeze({backupId,createdAt,encrypted,objects:Object.freeze(stored),manifestSha256:digestObjects(objects)});
}
export function assertRestore(manifest:BackupManifest,restored:readonly BackupObject[]):void{
 if(!manifest.encrypted||digestObjects(manifest.objects)!==manifest.manifestSha256||digestObjects(restored)!==manifest.manifestSha256)throw new Error("restore verification failed");
}

export interface SafetyControls { readonly liveTradingKilled:boolean;readonly liveOutreachKilled:boolean;readonly settlementKilled:boolean;readonly identityReleaseKilled:boolean;readonly reason:string;readonly changedAt:string; }
export function assertControlAllows(control:SafetyControls,operation:"TRADING"|"OUTREACH"|"SETTLEMENT"|"IDENTITY_RELEASE"):void{
 const stopped=operation==="TRADING"?control.liveTradingKilled:operation==="OUTREACH"?control.liveOutreachKilled:operation==="SETTLEMENT"?control.settlementKilled:control.identityReleaseKilled;
 if(stopped)throw new Error(`${operation.toLowerCase()} killed: ${control.reason}`);
}

export interface WorkflowDecision { readonly sequence:number;readonly eventType:string;readonly eventDigest:string;readonly decision:string; }
export function assertDeterministicReplay(original:readonly WorkflowDecision[],replay:readonly WorkflowDecision[]):void{
 const normalize=(values:readonly WorkflowDecision[])=>JSON.stringify(values.map(value=>[value.sequence,value.eventType,value.eventDigest,value.decision]));
 if(normalize(original)!==normalize(replay))throw new Error("workflow replay nondeterministic");
}
export function boundedMetric(name:string,value:number,labels:Readonly<Record<string,string>>):Readonly<{name:string;value:number;labels:Readonly<Record<string,string>>}>{
 if(!/^[a-z][a-z0-9_.]{1,63}$/.test(name)||!Number.isFinite(value)||Object.keys(labels).length>8)throw new Error("metric rejected");
 for(const [key,label] of Object.entries(labels))if(key.length>32||label.length>64)throw new Error("metric cardinality rejected");
 return Object.freeze({name,value,labels:Object.freeze({...labels})});
}
