import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createOutboundMime } from "../connectors/communication_brain.js";
import type { ImmutableEvidenceStore } from "./object_store.js";
import type { SensitiveDataCipher } from "./sensitive_data.js";
import { inTransaction } from "./database.js";
import { resolveCurrentAcquisitionOutreachPolicy } from "./outreach_policy.js";

/** Creates the first message only after verified contact, current risk PASS and
 * a lawful acquisition basis. Buyer outreach additionally requires a current
 * source-backed application profile and real compatible inventory. */
export class AcquisitionOutreachDispatcher {
  constructor(
    readonly pool: Pool,
    readonly store: ImmutableEvidenceStore,
    readonly cipher: SensitiveDataCipher,
    readonly from: string,
  ) {}
  async dispatchBatch(limit = 20): Promise<number> {
    const jobs = await inTransaction(
      this.pool,
      async (client) =>
        (
          await client.query(
            "with claimed as(select id from acquisition_outreach_jobs where state='PENDING' or(state='PROCESSING' and claimed_at<now()-interval '10 minutes') order by created_at for update skip locked limit $1) update acquisition_outreach_jobs j set state='PROCESSING',attempts=attempts+1,claimed_at=now() from claimed where j.id=claimed.id returning j.*",
            [limit],
          )
        ).rows,
    );
    let completed = 0;
    for (const job of jobs)
      try {
        const facts = (
          await this.pool.query(
            "select o.organization_type,c.id contact_id,c.normalized_email_ciphertext email_ciphertext,c.email_lookup_hash,p.target_product_family,p.application from organizations o join lateral(select * from contacts c where c.organization_id=o.id and c.verification='VERIFIED' and not exists(select 1 from global_suppressions s where s.email_lookup_hash=c.email_lookup_hash) order by c.verified_at desc limit 1)c on true join lateral(select state from risk_decisions r where r.organization_id=o.id order by r.decided_at desc limit 1)risk on risk.state='PASS' left join acquisition_profiles p on p.organization_id=o.id and p.classification_state in('SOURCE_STATED','VERIFIED') and p.valid_until>now() where o.id=$1",
            [job.organization_id],
          )
        ).rows[0];
        if (!facts)
          throw new Error("verified contact or risk PASS unavailable");
        const outreachPolicyVersion =
          await resolveCurrentAcquisitionOutreachPolicy(
            this.pool,
            facts.contact_id,
          );
        let subject: string, body: string;
        if (facts.organization_type === "SUPPLIER") {
          subject = "Current polymer availability request";
          body =
            "SableStone is qualifying current polymer supply for protected buyer matching. Please reply with material, grade/application, colour, MFI range, available MT, monthly capacity, MOQ, dispatch location, supplier NET INR/kg, payment terms, lead time, COA, TDS and current registration evidence. SableStone does not buy inventory or request credit.";
        } else if (facts.organization_type === "BUYER") {
          if (!facts.target_product_family)
            throw new Error(
              "buyer source-backed application profile unavailable",
            );
          const offer = (
            await this.pool.query(
              "select product_family,product_spec,quantity_mt from supplier_offers where product_family=$1 and verification='VERIFIED' and freshness='CURRENT' and expires_at>now() order by created_at desc limit 1",
              [facts.target_product_family],
            )
          ).rows[0];
          if (!offer) throw new Error("real compatible inventory unavailable");
          subject = `Current ${offer.product_family} allocation`;
          body = `SableStone has current verified ${offer.product_family} inventory available for ${facts.application}. Reply with required MT, destination, MFI/specification limits, maximum executable INR/kg and required date. Counterparty identity remains sealed until protected terms and settlement entitlement are secured.`;
        } else throw new Error("acquisition organization role unsupported");
        const recipient = this.cipher.decrypt(facts.email_ciphertext),
          communicationId = randomUUID(),
          threadId = `acquisition-${job.organization_id}`,
          messageId = `<${createHash("sha256").update(`acquisition:${job.id}`).digest("hex")}@mail.sablestone.internal>`,
          mime = createOutboundMime({
            from: this.from,
            to: recipient,
            subject,
            messageId,
            body,
          }),
          receipt = await this.store.preserve(
            "communications/outbound/acquisition",
            mime,
            "message/rfc822",
            `acquisition:${job.id}`,
            new Date().toISOString(),
          );
        await inTransaction(this.pool, async (client) => {
          await client.query(
            "insert into communications(id,external_event_id,event_type,thread_id,message_id,sender_ciphertext,recipient_ciphertext,occurred_at,payload_object_key) values($1,$2,'MESSAGE_SENT',$3,$4,$5,$6,now(),$7)",
            [
              communicationId,
              `acquisition:${job.id}`,
              threadId,
              messageId,
              this.cipher.encrypt(this.from),
              facts.email_ciphertext,
              receipt.objectKey,
            ],
          );
          await client.query(
            "insert into communication_organizations(communication_id,organization_id,contact_id) values($1,$2,$3)",
            [communicationId, job.organization_id, facts.contact_id],
          );
          await client.query(
            "insert into outbound_email_jobs(id,idempotency_key,source_communication_id,thread_id,recipient_ciphertext,recipient_lookup_hash,subject,message_id,mime_object_key,mime_sha256,state,message_class,source_contact_id,outreach_policy_version) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING','ACQUISITION',$11,$12)",
            [
              randomUUID(),
              `acquisition:${job.id}`,
              communicationId,
              threadId,
              facts.email_ciphertext,
              facts.email_lookup_hash,
              subject,
              messageId,
              receipt.objectKey,
              receipt.sha256,
              facts.contact_id,
              outreachPolicyVersion,
            ],
          );
          await client.query(
            "update acquisition_outreach_jobs set state='COMPLETED',completed_at=now(),claimed_at=null where id=$1 and state='PROCESSING'",
            [job.id],
          );
        });
        completed++;
      } catch (error) {
        const suppress = /unavailable|unsupported/i.test(
          (error as Error).message,
        );
        await this.pool.query(
          "update acquisition_outreach_jobs set state=case when $2 then 'SUPPRESSED' when attempts>=5 then 'FAILED' else 'PENDING' end,completed_at=case when $2 or attempts>=5 then now() else null end,claimed_at=null,last_error_code=$3 where id=$1 and state='PROCESSING'",
          [job.id, suppress, (error as Error).message.slice(0, 100)],
        );
      }
    return completed;
  }
}
