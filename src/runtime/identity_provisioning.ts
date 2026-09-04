import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ImmutableEvidenceStore } from "./object_store.js";
import type { SensitiveDataCipher } from "./sensitive_data.js";
import { createPinnedPublicFetch, readBoundedResponseBody, resolveExternalProviderEndpoint } from "./public_network.js";
import { inTransaction } from "./database.js";

export interface IdentityProvisioningConfig {
  readonly baseUrl:string;
  readonly invitePath:string;
  readonly authorizationHeader:string;
  readonly connection:string;
}
export class IdentityProvisioningDispatcher {
  constructor(readonly pool:Pool,readonly store:ImmutableEvidenceStore,readonly cipher:SensitiveDataCipher,readonly config:IdentityProvisioningConfig,readonly fetcher:typeof fetch=createPinnedPublicFetch()){
    if(!config.baseUrl.startsWith("https://")||!config.invitePath.startsWith("/")||!config.authorizationHeader||!config.connection)throw new Error("identity provisioning configuration invalid");
  }
  async dispatchBatch(limit=20):Promise<number>{
    await this.pool.query("insert into identity_provisioning_jobs(id,contact_id,organization_id,role,state) select gen_random_uuid(),c.id,c.organization_id,o.organization_type,'PENDING' from contacts c join organizations o on o.id=c.organization_id and o.organization_type in('SUPPLIER','BUYER') where c.verification='VERIFIED' and exists(select 1 from risk_decisions r where r.organization_id=o.id and r.state='PASS') on conflict(contact_id) do nothing");
    const jobs=(await this.pool.query("with redriven as(update identity_provisioning_jobs set state='PENDING',redrive_count=redrive_count+1,next_retry_at=null where state='DEAD_LETTER_PENDING_REDRIVE' and next_retry_at<=now()),claimed as(select id from identity_provisioning_jobs where state='PENDING' or(state='PROCESSING' and claimed_at<now()-interval '10 minutes') order by created_at for update skip locked limit $1) update identity_provisioning_jobs j set state='PROCESSING',attempts=attempts+1,claimed_at=now() from claimed where j.id=claimed.id returning j.*",[limit])).rows;let count=0;
    for(const job of jobs){try{const contact=(await this.pool.query("select normalized_email_ciphertext from contacts where id=$1 and organization_id=$2 and verification='VERIFIED'",[job.contact_id,job.organization_id])).rows[0];if(!contact)throw new Error("verified identity contact unavailable");const url=resolveExternalProviderEndpoint(this.config.baseUrl,this.config.invitePath),payload=JSON.stringify({email:this.cipher.decrypt(contact.normalized_email_ciphertext),organization_id:job.organization_id,role:job.role,connection:this.config.connection,idempotency_key:job.id}),response=await this.fetcher(url,{method:"POST",headers:{authorization:this.config.authorizationHeader,"content-type":"application/json","idempotency-key":job.id},body:payload,signal:AbortSignal.timeout(30_000)}),bytes=await readBoundedResponseBody(response,1_000_000),receipt=await this.store.preserve("identity/invitations",bytes,response.headers.get("content-type")??"application/json",url.toString());if(!response.ok)throw new Error(`identity invite HTTP ${response.status}; receipt=${receipt.objectKey}`);const decoded=JSON.parse(new TextDecoder().decode(bytes)) as Record<string,unknown>,subject=String(decoded.subject??decoded.user_id??"");if(!subject)throw new Error("identity invite subject missing");await inTransaction(this.pool,async client=>{await client.query("insert into counterparty_principals(principal_id,organization_id,contact_id,role,issuer_subject,state,invited_at) values($1,$2,$3,$4,$5,'INVITED',now()) on conflict(issuer_subject) do nothing",[randomUUID(),job.organization_id,job.contact_id,job.role,subject]);await client.query("update identity_provisioning_jobs set state='INVITED',provider_reference=$2,completed_at=now(),claimed_at=null where id=$1 and state='PROCESSING'",[job.id,subject]);});count++;}catch(error){await this.pool.query("update identity_provisioning_jobs set state=case when attempts>=5 then 'DEAD_LETTER_PENDING_REDRIVE' else 'PENDING' end,claimed_at=null,last_error_code=$2,next_retry_at=case when attempts>=5 then now()+least(interval '24 hours',interval '15 minutes'*power(2,least(redrive_count,6))) else null end where id=$1",[job.id,(error as Error).name.slice(0,100)]);}}
    return count;
  }
}
