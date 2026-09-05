import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createOutboundMime } from "../connectors/communication_brain.js";
import type { ImmutableEvidenceStore } from "./object_store.js";
import type { SensitiveDataCipher } from "./sensitive_data.js";
import { inTransaction } from "./database.js";
import { resolveCurrentAcquisitionOutreachPolicy } from "./outreach_policy.js";
import { deepCompatible } from "./stage_handlers.js";

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
            "with redriven as(update acquisition_outreach_jobs set state='READY',redrive_count=redrive_count+1,next_retry_at=null where state='DEAD_LETTER_PENDING_REDRIVE' and next_retry_at<=now()),claimed as(select id from acquisition_outreach_jobs where state in('WAITING_CONTACT','WAITING_RISK','WAITING_PROFILE','WAITING_INVENTORY','READY') or(state='PROCESSING' and claimed_at<now()-interval '10 minutes') order by priority_score desc,created_at for update skip locked limit $1) update acquisition_outreach_jobs j set state='PROCESSING',attempts=attempts+1,claimed_at=now() from claimed where j.id=claimed.id returning j.*",
            [limit],
          )
        ).rows,
    );
    let completed = 0;
    for (const job of jobs)
      try {
        const organization = (
          await this.pool.query(
            "select organization_type from organizations where id=$1",
            [job.organization_id],
          )
        ).rows[0];
        if (!organization)
          throw new TerminalSuppression("acquisition organization missing");
        const contact = (
          await this.pool.query(
            "select id contact_id,normalized_email_ciphertext email_ciphertext,email_lookup_hash from contacts c where c.organization_id=$1 and c.verification='VERIFIED' and not exists(select 1 from global_suppressions s where s.email_lookup_hash=c.email_lookup_hash) order by c.verified_at desc limit 1",
            [job.organization_id],
          )
        ).rows[0];
        if (!contact)
          throw new WaitingState("WAITING_CONTACT", "verified contact pending");
        const risk = (
          await this.pool.query(
            "select state from risk_decisions where organization_id=$1 order by decided_at desc limit 1",
            [job.organization_id],
          )
        ).rows[0];
        if (!risk || !["PASS", "REJECT"].includes(String(risk.state)))
          throw new WaitingState(
            "WAITING_RISK",
            "current risk decision pending",
          );
        if (risk.state === "REJECT")
          throw new TerminalSuppression("counterparty risk rejected");
        const facts = { ...organization, ...contact };
        const outreachPolicyVersion =
          await resolveCurrentAcquisitionOutreachPolicy(
            this.pool,
            facts.contact_id,
          );
        let subject: string, body: string;
        if (facts.organization_type === "SUPPLIER") {
          subject = "Current polymer availability request";
          body =
            "SableStone is qualifying current polymer supply for protected buyer matching. Please reply with material, grade/application, colour, MFI range, density, ash, moisture, PCR/PIR status, available MT, monthly capacity, MOQ, dispatch location, supplier NET price/kg, currency, price basis, Incoterm, payment terms, lead time, COA, TDS and current registration evidence. SableStone does not buy inventory or request credit.";
        } else if (facts.organization_type === "BUYER") {
          const candidates = (
            await this.pool.query(
              "select p.target_product_family,p.application,o.product_family,o.product_spec,o.quantity_mt,o.moq_mt,o.currency,o.supplier_net,pp.commission_floor_per_kg,o.supplier_net+pp.commission_floor_per_kg indicative_ex_dispatch from acquisition_profiles p join supplier_offers o on o.product_family=p.target_product_family and o.verification='VERIFIED' and o.freshness='CURRENT' and o.expires_at>now() and o.version=(select max(version) from supplier_offers current where current.id=o.id) join lateral(select policy.* from pricing_policies policy join authority_receipts ar on ar.receipt_id=policy.approval_receipt_id and ar.authority_kind='PRICING_POLICY_APPROVAL' and ar.retrieved_at<=now() and ar.effective_at<=now() and ar.expires_at>now() where policy.currency=o.currency and policy.valid_from<=now() and policy.valid_until>now() order by policy.valid_from desc limit 1)pp on true where p.organization_id=$1 and ($2::uuid is null or p.id=$2) and p.classification_state in('SOURCE_STATED','VERIFIED') and p.valid_until>now() order by o.quantity_mt*pp.commission_floor_per_kg desc,o.quantity_mt desc,p.created_at limit 100",
              [job.organization_id, job.acquisition_profile_id],
            )
          ).rows;
          const lane = candidates.find((candidate) =>
            deepCompatible(candidate.product_spec, {
              application: candidate.application,
            }),
          );
          if (!lane) {
            const hasProfile = (
              await this.pool.query(
                "select 1 from acquisition_profiles where organization_id=$1 and ($2::uuid is null or id=$2) and classification_state in('SOURCE_STATED','VERIFIED') and valid_until>now() limit 1",
                [job.organization_id, job.acquisition_profile_id],
              )
            ).rowCount;
            throw new WaitingState(
              hasProfile ? "WAITING_INVENTORY" : "WAITING_PROFILE",
              hasProfile
                ? "compatible inventory pending"
                : "buyer profile pending",
            );
          }
          await this.pool.query(
            "update acquisition_outreach_jobs set priority_score=$2*1000*$3 where id=$1 and priority_state='HEURISTIC'",
            [job.id, lane.quantity_mt, lane.commission_floor_per_kg],
          );
          const spec = sanitizedLotSpec(lane.product_spec);
          subject = `Current ${lane.product_family} allocation — ${lane.quantity_mt} MT`;
          body = [
            `SableStone has a current verified ${lane.product_family} allocation for ${lane.application}.`,
            `Available: ${lane.quantity_mt} MT`,
            `MOQ: ${lane.moq_mt} MT`,
            ...spec,
            `Indicative ex-dispatch level: ${lane.currency} ${lane.indicative_ex_dispatch}/kg (freight and other destination-specific transaction costs will be calculated before any executable quote).`,
            "Reply with required MT, destination, specification limits, maximum executable price and required date.",
            "Supplier identity remains sealed until protected terms and the exact settlement entitlement are secured.",
          ].join("\n");
        } else
          throw new TerminalSuppression(
            "acquisition organization role unsupported",
          );
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
        const waiting = error instanceof WaitingState,
          suppress = error instanceof TerminalSuppression;
        await this.pool.query(
          "update acquisition_outreach_jobs set state=case when $2 then $3 when $4 then 'SUPPRESSED' when attempts>=5 then 'DEAD_LETTER_PENDING_REDRIVE' else 'READY' end,completed_at=case when $4 then now() else null end,claimed_at=null,next_retry_at=case when $2 or $4 then null when attempts>=5 then now()+least(interval '24 hours',interval '15 minutes'*power(2,least(redrive_count,6))) else null end,last_error_code=$5 where id=$1 and state='PROCESSING'",
          [
            job.id,
            waiting,
            waiting ? (error as WaitingState).state : "READY",
            suppress,
            (error as Error).message.slice(0, 100),
          ],
        );
      }
    return completed;
  }
}

type WaitingAcquisitionState =
  | "WAITING_CONTACT"
  | "WAITING_RISK"
  | "WAITING_PROFILE"
  | "WAITING_INVENTORY";
class WaitingState extends Error {
  constructor(
    readonly state: WaitingAcquisitionState,
    message: string,
  ) {
    super(message);
  }
}
class TerminalSuppression extends Error {}

function sanitizedLotSpec(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const spec = value as Record<string, unknown>,
    rows: string[] = [];
  for (const [label, keys] of [
    ["Application", ["application", "grade"]],
    ["MFI", ["mfi", "mfiRange", "mfi_min", "mfi_max"]],
    ["Colour", ["colour", "color"]],
    ["Dispatch region", ["dispatchRegion", "dispatch_location", "region"]],
  ] as const) {
    const parts = keys.flatMap((key) =>
      spec[key] === undefined || spec[key] === null ? [] : [String(spec[key])],
    );
    if (parts.length) rows.push(`${label}: ${parts.join("–")}`);
  }
  return rows;
}
