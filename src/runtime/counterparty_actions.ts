import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ImmutableEvidenceStore } from "./object_store.js";
import type { SensitiveDataCipher } from "./sensitive_data.js";
import type { GmailProductionConnector } from "../connectors/gmail.js";
import { createReplyMime } from "../connectors/communication_brain.js";
import { inTransaction } from "./database.js";

export class CounterpartyActionDispatcher {
  constructor(
    readonly pool: Pool,
    readonly store: ImmutableEvidenceStore,
    readonly cipher: SensitiveDataCipher,
    readonly gmail: GmailProductionConnector,
    readonly portalBaseUrl: string,
    readonly actionSecret: string,
  ) {
    if (!portalBaseUrl.startsWith("https://") || actionSecret.length < 32)
      throw new Error("counterparty action configuration invalid");
  }
  async dispatchBatch(limit = 25): Promise<number> {
    await this.project();
    const jobs = await inTransaction(this.pool, async (client) => (
      await client.query(
        "with redriven as(update counterparty_action_notifications set state='PENDING',redrive_count=redrive_count+1,next_retry_at=null where state='DEAD_LETTER_PENDING_REDRIVE' and next_retry_at<=now()),claimed as(select n.action_id from counterparty_action_notifications n join counterparty_actions a on a.id=n.action_id where ((n.state in('PENDING','SENT') and n.next_notification_at<=now()) or(n.state='PROCESSING' and n.claimed_at<now()-interval '10 minutes')) and a.state in('REQUIRED','NOTIFIED') and a.deadline>now() order by a.deadline for update of n skip locked limit $1) update counterparty_action_notifications n set state='PROCESSING',attempts=attempts+1,claimed_at=now() from claimed where n.action_id=claimed.action_id returning n.*",
        [limit],
      )
    ).rows);
    let sent=0;
    for(const job of jobs){
      try{
        const facts=(await this.pool.query("select a.*,c.id contact_id,c.normalized_email_ciphertext,c.email_lookup_hash from counterparty_actions a join lateral(select * from contacts c where c.organization_id=a.organization_id and c.verification='VERIFIED' and not exists(select 1 from global_suppressions s where s.email_lookup_hash=c.email_lookup_hash) order by c.verified_at desc limit 1)c on true where a.id=$1 and a.state in('REQUIRED','NOTIFIED')",[job.action_id])).rows[0];
        if(!facts)throw new Error("action or verified contact unavailable");
        const token=this.token(String(facts.id)),url=`${this.portalBaseUrl}/actions/${facts.id}?token=${encodeURIComponent(token)}`,recipient=this.cipher.decrypt(facts.normalized_email_ciphertext),messageId=`<${createHash("sha256").update(`action:${facts.id}`).digest("hex")}@mail.sablestone.internal>`,subject=`Action required: ${String(facts.action_type).replaceAll("_"," ")}`,mime=createReplyMime({from:this.gmail.config.userId,to:recipient,subject,inReplyTo:`<action-${facts.id}@mail.sablestone.internal>`,messageId,body:["SableStone protected transaction","",`Required action: ${facts.action_type}`,`Deadline: ${new Date(facts.deadline).toISOString()}`,`Secure action: ${url}`,"","This link is scoped to your organization. SableStone will never ask you to bypass the protected settlement rail."].join("\n")}),stored=await this.store.preserve("email/outbound",mime,"message/rfc822",`action:${facts.id}`),communicationId=randomUUID();
        await inTransaction(this.pool,async(client)=>{
          await client.query("insert into communications(id,external_event_id,event_type,thread_id,message_id,sender_ciphertext,recipient_ciphertext,occurred_at,payload_object_key) values($1,$2,'MESSAGE_SENT',$3,$4,$5,$6,now(),$7)",[communicationId,`action:${facts.id}`,`action-${facts.id}`,messageId,this.cipher.encrypt(this.gmail.config.userId),facts.normalized_email_ciphertext,stored.objectKey]);
          await client.query("insert into communication_organizations(communication_id,organization_id,contact_id) values($1,$2,$3)",[communicationId,facts.organization_id,facts.contact_id]);
          await client.query("insert into outbound_email_jobs(id,idempotency_key,source_communication_id,thread_id,recipient_ciphertext,recipient_lookup_hash,subject,message_id,mime_object_key,mime_sha256,state,message_class) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING','TRANSACTIONAL')",[randomUUID(),`action:${facts.id}`,communicationId,`action-${facts.id}`,facts.normalized_email_ciphertext,facts.email_lookup_hash,subject,messageId,stored.objectKey,stored.sha256]);
          await client.query("update counterparty_actions set state='NOTIFIED' where id=$1 and state='REQUIRED'",[facts.id]);
          await client.query("update counterparty_action_notifications set state='SENT',sent_at=now(),claimed_at=null,reminder_count=reminder_count+1,next_notification_at=least($2,now()+interval '24 hours') where action_id=$1",[facts.id,facts.deadline]);
        });sent++;
      }catch(error){await this.pool.query("update counterparty_action_notifications set state=case when attempts>=5 then 'DEAD_LETTER_PENDING_REDRIVE' else 'PENDING' end,claimed_at=null,last_error_code=$2,next_retry_at=case when attempts>=5 then now()+least(interval '24 hours',interval '15 minutes'*power(2,least(redrive_count,6))) else null end where action_id=$1",[job.action_id,(error as Error).name.slice(0,100)]);}
    }
    return sent;
  }
  private token(id:string){return createHmac("sha256",this.actionSecret).update(id).digest("base64url")}
  private async project():Promise<void>{
    await this.pool.query("update counterparty_actions a set state='COMPLETED',completed_at=now() from settlement_instruction_acceptances s where a.resource_type='SETTLEMENT_INSTRUCTION' and a.resource_id=s.instruction_id and a.organization_id=s.organization_id and a.action_type in('SUPPLIER_ACCEPT_SETTLEMENT','BUYER_ACCEPT_SETTLEMENT') and a.state in('REQUIRED','NOTIFIED')");
    await this.pool.query("update counterparty_actions a set state='COMPLETED',completed_at=now() from trade_contract_acceptances c where a.resource_type='TRADE' and a.resource_id=c.trade_id and a.organization_id=c.organization_id and a.action_type in('SUPPLIER_ACCEPT_CONTRACT','BUYER_ACCEPT_CONTRACT') and a.state in('REQUIRED','NOTIFIED')");
    await this.pool.query("update counterparty_actions a set state='COMPLETED',completed_at=now() from trades t join matches m on m.id=t.match_id join standing_demand_authorizations s on s.demand_id=m.demand_id and s.demand_version=m.demand_version where a.resource_type='TRADE' and a.resource_id=t.id and a.organization_id=s.buyer_id and a.action_type='BUYER_AUTHORIZE_STANDING_ORDER' and a.state in('REQUIRED','NOTIFIED')");
    await this.pool.query("update counterparty_actions a set state='COMPLETED',completed_at=now() from settlement_instructions i join trades t on t.id=i.trade_id where a.resource_type='SETTLEMENT_INSTRUCTION' and a.resource_id=i.id and a.action_type='BUYER_FUND_TRANSACTION' and a.state in('REQUIRED','NOTIFIED') and t.state not in('PROTECTED')");
    await this.pool.query("update counterparty_actions set state='EXPIRED' where state in('REQUIRED','NOTIFIED') and deadline<=now()");
    await this.pool.query("update supplier_payout_controls p set state='FROZEN',updated_at=now(),last_error_code='DELIVERY_ACCEPTANCE_OVERDUE' from counterparty_actions a where a.resource_type='TRADE' and a.resource_id=p.trade_id and a.action_type='BUYER_ACCEPT_DELIVERY' and a.state='EXPIRED' and p.state in('HELD','RELEASE_PENDING')");
    const bindings=(await this.pool.query("select b.resource_type,b.resource_id,b.expected_organization_id organization_id,b.role,a.agreement_kind,a.expires_at from agreement_resource_bindings b join agreements a on a.id=b.agreement_id and a.version=b.agreement_version where a.expires_at>now() and not exists(select 1 from agreement_acceptances x where x.agreement_binding_id=b.id) and b.role in('SUPPLIER','BUYER')")).rows;
    for(const binding of bindings){const actionType=binding.agreement_kind==='PROTECTED_ACCOUNT_NOTICE'?'SUPPLIER_ACCEPT_PROTECTED_ACCOUNT':binding.agreement_kind==='PROTECTED_SUPPLIER_ACKNOWLEDGEMENT'?'BUYER_ACCEPT_PROTECTED_SUPPLIER':`${binding.role}_ACCEPT_CONTRACT`,id=randomUUID(),tokenDigest=createHash("sha256").update(this.token(id)).digest("hex"),inserted=await this.pool.query("insert into counterparty_actions(id,action_type,resource_type,resource_id,organization_id,actor_role,state,deadline,evidence_required,action_token_digest) values($1,$2,$3,$4,$5,$6,'REQUIRED',$7,false,$8) on conflict(action_type,resource_type,resource_id,organization_id) do nothing returning id",[id,actionType,binding.resource_type,binding.resource_id,binding.organization_id,binding.role,binding.expires_at,tokenDigest]);if(inserted.rowCount)await this.pool.query("insert into counterparty_action_notifications(action_id,state) values($1,'PENDING')",[id]);}
    await this.pool.query("update counterparty_actions a set state='COMPLETED',completed_at=now() from trades t where a.resource_type='TRADE' and a.resource_id=t.id and a.state in('REQUIRED','NOTIFIED') and ((a.action_type in('BUYER_ACCEPT_DELIVERY','BUYER_OPEN_DISPUTE') and t.state not in('DELIVERED')) or(a.action_type='SUPPLIER_UPLOAD_DISPATCH_EVIDENCE' and t.state not in('FUNDED')) or(a.action_type like '%ACCEPT_CONTRACT' and t.state not in('IDENTITY_RELEASED')))");
    const rows=(await this.pool.query("select t.id trade_id,t.supplier_id,t.buyer_id,t.state,coalesce(si.id,t.id) resource_id,coalesce(si.acknowledged,false) settlement_acknowledged from trades t left join lateral(select id,acknowledged from settlement_instructions where trade_id=t.id order by created_at desc limit 1)si on true where t.state in('PROTECTED','IDENTITY_RELEASED','FUNDED','DELIVERED','SETTLED','RECURRING')")).rows;
    for(const row of rows){
      const specs:readonly (readonly [string,string,string,string,number,boolean])[]=row.state==='PROTECTED'&&row.resource_id!==row.trade_id?[["SUPPLIER_ACCEPT_SETTLEMENT","SETTLEMENT_INSTRUCTION",row.resource_id,row.supplier_id,7,false],["BUYER_ACCEPT_SETTLEMENT","SETTLEMENT_INSTRUCTION",row.resource_id,row.buyer_id,7,false],...(row.settlement_acknowledged?[["BUYER_FUND_TRANSACTION","SETTLEMENT_INSTRUCTION",row.resource_id,row.buyer_id,7,false] as const]:[])]:row.state==='IDENTITY_RELEASED'?[["SUPPLIER_ACCEPT_CONTRACT","TRADE",row.trade_id,row.supplier_id,7,false],["BUYER_ACCEPT_CONTRACT","TRADE",row.trade_id,row.buyer_id,7,false]]:row.state==='FUNDED'?[["SUPPLIER_UPLOAD_DISPATCH_EVIDENCE","TRADE",row.trade_id,row.supplier_id,7,true]]:row.state==='DELIVERED'?[["BUYER_ACCEPT_DELIVERY","TRADE",row.trade_id,row.buyer_id,3,false],["BUYER_OPEN_DISPUTE","TRADE",row.trade_id,row.buyer_id,3,true]]:row.state==='SETTLED'||row.state==='RECURRING'?[["BUYER_AUTHORIZE_STANDING_ORDER","TRADE",row.trade_id,row.buyer_id,14,false]]:[];
      for(const [type,resourceType,resourceId,organizationId,days,evidence] of specs){const id=randomUUID(),tokenDigest=createHash("sha256").update(this.token(id)).digest("hex"),inserted=await this.pool.query("insert into counterparty_actions(id,action_type,resource_type,resource_id,organization_id,actor_role,state,deadline,evidence_required,action_token_digest) values($1,$2,$3,$4,$5,$6,'REQUIRED',now()+(interval '1 day'*$7),$8,$9) on conflict(action_type,resource_type,resource_id,organization_id) do nothing returning id",[id,type,resourceType,resourceId,organizationId,type.startsWith("SUPPLIER")?"SUPPLIER":"BUYER",days,evidence,tokenDigest]);if(inserted.rowCount)await this.pool.query("insert into counterparty_action_notifications(action_id,state) values($1,'PENDING')",[id]);}
    }
  }
}
