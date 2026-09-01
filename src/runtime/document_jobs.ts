import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  ClamAvTcpScanner,
  DocumentIngestionPipeline,
  ProductionDocumentHttpExtractor,
  ProductionDocumentVerifier,
  ingestMimeAttachments,
  type DocumentExtractorHttpConfig,
  type DocumentVerifierHttpConfig,
} from "../connectors/documents.js";
import type { ImmutableEvidenceStore } from "./object_store.js";
import { inTransaction, TransactionalOutboxRepository } from "./database.js";
import { SensitiveDataCipher } from "./sensitive_data.js";
import { assertCurrentAuthorityReceipt } from "./authority_receipts.js";
export async function buildProductionDocumentPipeline(
  pool: Pool,
  store: ImmutableEvidenceStore,
  serialized: string | undefined,
  clamHost: string | undefined,
  clamPort: string | undefined,
): Promise<DocumentIngestionPipeline | null> {
  if (!serialized) return null;
  const config = JSON.parse(serialized) as DocumentExtractorHttpConfig;
  await assertCurrentAuthorityReceipt(
    pool,
    config.approvalReceiptId,
    "DOCUMENT_EXTRACTION_APPROVAL",
  );
  if (!clamHost || !clamPort || !Number.isInteger(Number(clamPort)))
    throw new Error("ClamAV production configuration incomplete");
  return new DocumentIngestionPipeline(
    store,
    new ClamAvTcpScanner(clamHost, Number(clamPort)),
    new ProductionDocumentHttpExtractor(config, store),
  );
}
export async function buildProductionDocumentVerifier(
  pool: Pool,
  store: ImmutableEvidenceStore,
  serialized: string | undefined,
): Promise<ProductionDocumentVerifier | null> {
  if (!serialized) return null;
  const config = JSON.parse(serialized) as DocumentVerifierHttpConfig;
  await assertCurrentAuthorityReceipt(
    pool,
    config.approvalReceiptId,
    "DOCUMENT_VERIFICATION_APPROVAL",
  );
  return new ProductionDocumentVerifier(config, store);
}

export class DocumentJobDispatcher {
  constructor(
    readonly pool: Pool,
    readonly store: ImmutableEvidenceStore,
    readonly cipher: SensitiveDataCipher,
    readonly pipeline: DocumentIngestionPipeline,
  ) {}
  async dispatchBatch(limit = 10): Promise<number> {
    const jobs = await inTransaction(
      this.pool,
      async (client) =>
        (
          await client.query(
            "with claimed as(select id from document_processing_jobs where state='PENDING' or(state='PROCESSING' and claimed_at<now()-interval '10 minutes') order by created_at for update skip locked limit $1) update document_processing_jobs j set state='PROCESSING',attempts=attempts+1,claimed_at=now() from claimed where j.id=claimed.id returning j.*",
            [limit],
          )
        ).rows,
    );
    let completed = 0;
    for (const job of jobs) {
      try {
        const raw = await this.store.readVerified(
            job.raw_mime_object_key,
            job.raw_mime_sha256,
          ),
          documents = await ingestMimeAttachments(
            raw,
            this.pipeline,
            job.source_message_id,
          );
        await inTransaction(this.pool, async (client) => {
          const owner = (
            await client.query(
              "select organization_id from communication_organizations where communication_id=$1",
              [job.communication_id],
            )
          ).rows[0];
          if (!owner) throw new Error("document owner organization missing");
          for (const document of documents) {
            const documentId = randomUUID();
            await client.query(
              "insert into documents(id,organization_id,kind,object_key_ciphertext,sha256) values($1,$2,$3,$4,$5)",
              [
                documentId,
                owner.organization_id,
                document.extraction.kind,
                this.cipher.encrypt(document.objectKey),
                document.sha256,
              ],
            );
            await client.query(
              "insert into attachment_checks(id,communication_id,object_key,media_type,compressed_bytes,expanded_bytes,member_count,malware_state,accepted) values($1,$2,$3,$4,$5,$5,1,'CLEAN',true)",
              [
                randomUUID(),
                job.communication_id,
                document.objectKey,
                document.mediaType,
                document.bytes,
              ],
            );
            await client.query(
              "insert into extraction_proposals(id,communication_id,source_body_sha256,extractor_version,status,proposed_payload,reasons,verified) values($1,$2,$3,$4,'PROPOSED',$5,'[]'::jsonb,false) on conflict(communication_id,extractor_version,source_body_sha256) do nothing",
              [
                randomUUID(),
                job.communication_id,
                document.sha256,
                `${document.extraction.extractor}:${document.extraction.modelVersion}`,
                document.extraction,
              ],
            );
            await client.query(
              "insert into document_verification_jobs(id,document_id,object_key,sha256,extraction,state) values($1,$2,$3,$4,$5,'PENDING')",
              [
                randomUUID(),
                documentId,
                document.objectKey,
                document.sha256,
                document.extraction,
              ],
            );
          }
          await client.query(
            "update document_processing_jobs set state='COMPLETED',completed_at=now(),claimed_at=null where id=$1 and state='PROCESSING'",
            [job.id],
          );
        });
        completed++;
      } catch (error) {
        const security =
          /malware|media type|size|attachment count|aggregate rejected/i.test(
            (error as Error).message,
          );
        await this.pool.query(
          "update document_processing_jobs set state=case when $2 then 'REJECTED_SECURITY' when attempts>=5 then 'FAILED' else 'PENDING' end,completed_at=case when $2 or attempts>=5 then now() else null end,claimed_at=null,last_error_code=$3 where id=$1 and state='PROCESSING'",
          [job.id, security, (error as Error).name.slice(0, 100)],
        );
      }
    }
    return completed;
  }
}

export class DocumentVerificationJobDispatcher {
  constructor(
    readonly pool: Pool,
    readonly store: ImmutableEvidenceStore,
    readonly verifier: ProductionDocumentVerifier,
  ) {}
  async dispatchBatch(limit = 10): Promise<number> {
    const jobs = await inTransaction(
      this.pool,
      async (client) =>
        (
          await client.query(
            "with claimed as(select id from document_verification_jobs where state='PENDING' or(state='PROCESSING' and claimed_at<now()-interval '10 minutes') order by created_at for update skip locked limit $1) update document_verification_jobs j set state='PROCESSING',attempts=attempts+1,claimed_at=now() from claimed where j.id=claimed.id returning j.*",
            [limit],
          )
        ).rows,
    );
    let completed = 0;
    for (const job of jobs) {
      try {
        const bytes = await this.store.readVerified(job.object_key, job.sha256),
          result = await this.verifier.verify({
            bytes,
            sha256: job.sha256,
            extraction: job.extraction,
            documentId: job.document_id,
          }),
          now = new Date().toISOString();
        await inTransaction(this.pool, async (client) => {
          const receiptId = randomUUID();
          await client.query(
            "insert into document_verification_receipts(id,document_id,provider,external_reference,request_object_key,response_object_key,response_sha256,verified_at) values($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              receiptId,
              job.document_id,
              result.provider,
              result.externalReference,
              result.requestObjectKey,
              result.responseObjectKey,
              result.responseSha256,
              now,
            ],
          );
          for (const check of result.checks)
            await client.query(
              "insert into document_checks(id,document_id,check_type,state,source_receipt_id,valid_until,checked_at,checker_version) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(document_id,check_type,checker_version) do nothing",
              [
                randomUUID(),
                job.document_id,
                check.checkType,
                check.state,
                receiptId,
                check.validUntil,
                now,
                `${result.provider}:${this.verifier.config.policyVersion}`,
              ],
            );
          await client.query(
            "update document_verification_jobs set state=$2,completed_at=now(),claimed_at=null where id=$1 and state='PROCESSING'",
            [
              job.id,
              result.checks.every((check) => check.state === "VERIFIED")
                ? "VERIFIED"
                : "REJECTED",
            ],
          );
        });
        completed++;
      } catch (error) {
        const unavailable = /unavailable|approval/i.test(
          (error as Error).message,
        );
        await this.pool.query(
          "update document_verification_jobs set state=case when $2 then 'UNAVAILABLE' when attempts>=5 then 'FAILED' else 'PENDING' end,completed_at=case when $2 or attempts>=5 then now() else null end,claimed_at=null,last_error_code=$3 where id=$1 and state='PROCESSING'",
          [job.id, unavailable, (error as Error).name.slice(0, 100)],
        );
      }
    }
    return completed;
  }
}

export class QualificationJobDispatcher {
  constructor(readonly pool: Pool) {}
  async dispatchBatch(limit = 50): Promise<number> {
    const subjects = (
      await this.pool.query(
        "select 'SUPPLIER_OFFER' subject_type,id,version,supplier_id organization_id from supplier_offers where verification='DRAFT' union all select 'BUYER_DEMAND',id,version,buyer_id from buyer_demands where verification='DRAFT' order by version limit $1",
        [limit],
      )
    ).rows;
    let promoted = 0;
    for (const subject of subjects) promoted += await this.evaluate(subject);
    return promoted;
  }
  private async evaluate(subject: {
    subject_type: string;
    id: string;
    version: number;
    organization_id: string;
  }): Promise<number> {
    return inTransaction(this.pool, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        `qualify:${subject.subject_type}:${subject.id}:${subject.version}`,
      ]);
      const risk = (
          await client.query(
            "select id,state from risk_decisions where organization_id=$1 order by decided_at desc limit 1",
            [subject.organization_id],
          )
        ).rows[0],
        required =
          subject.subject_type === "SUPPLIER_OFFER"
            ? ["REGISTRATION", "COA", "TDS"]
            : ["GST_COMPANY"],
        checks: Array<{ id: string } | undefined> = [];
      for (const kind of required)
        checks.push(
          (
            await client.query(
              "select dc.id from documents d join document_checks dc on dc.document_id=d.id where d.organization_id=$1 and d.kind=$2 and dc.state='VERIFIED' and (dc.valid_until is null or dc.valid_until>now()) order by dc.checked_at desc limit 1",
              [subject.organization_id, kind],
            )
          ).rows[0],
        );
      const verdict =
          risk?.state === "REJECT"
            ? "FAIL"
            : risk?.state === "PASS" && checks.every(Boolean)
              ? "PASS"
              : "REQUEST_DOCUMENTS",
        reasons: string[] = [];
      if (risk?.state !== "PASS")
        reasons.push(`RISK_${risk?.state ?? "UNKNOWN"}`);
      required.forEach((kind, index) => {
        if (!checks[index]) reasons.push(`${kind}_VERIFICATION_MISSING`);
      });
      const evidenceDigest = createHash("sha256")
          .update(
            JSON.stringify({
              risk: risk?.id ?? null,
              checks: checks.map((check) => check?.id ?? null),
              verdict,
            }),
          )
          .digest("hex"),
        policyVersion = `production-auto-v1:${evidenceDigest}`;
      await client.query(
        "insert into qualification_decisions(id,organization_id,subject_type,subject_id,subject_version,verdict,reasons,policy_version,decided_at) values($1,$2,$3,$4,$5,$6,$7,$8,now()) on conflict(subject_type,subject_id,subject_version,policy_version) do nothing",
        [
          randomUUID(),
          subject.organization_id,
          subject.subject_type,
          subject.id,
          subject.version,
          verdict,
          reasons,
          policyVersion,
        ],
      );
      if (verdict !== "PASS") return 0;
      const table =
          subject.subject_type === "SUPPLIER_OFFER"
            ? "supplier_offers"
            : "buyer_demands",
        owner =
          subject.subject_type === "SUPPLIER_OFFER"
            ? "supplier_id"
            : "buyer_id",
        current = (
          await client.query(
            `select * from ${table} where id=$1 and version=$2 and ${owner}=$3 and verification='DRAFT' and freshness='CURRENT' and expires_at>now()`,
            [subject.id, subject.version, subject.organization_id],
          )
        ).rows[0];
      if (!current) return 0;
      const next = subject.version + 1;
      if (table === "supplier_offers")
        await client.query(
          "insert into supplier_offers(id,version,supplier_id,source_event_id,supersedes_offer_id,product_family,product_spec,quantity_mt,moq_mt,supplier_net,currency,expires_at,verification,freshness) values($1,$2,$3,$4,$1,$5,$6,$7,$8,$9,$10,$11,'VERIFIED','CURRENT')",
          [
            current.id,
            next,
            current.supplier_id,
            current.source_event_id,
            current.product_family,
            current.product_spec,
            current.quantity_mt,
            current.moq_mt,
            current.supplier_net,
            current.currency,
            current.expires_at,
          ],
        );
      else
        await client.query(
          "insert into buyer_demands(id,version,buyer_id,source_event_id,product_family,product_spec,quantity_mt,buyer_ceiling,ceiling_state,currency,standing,expires_at,verification,freshness) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'VERIFIED','CURRENT')",
          [
            current.id,
            next,
            current.buyer_id,
            current.source_event_id,
            current.product_family,
            current.product_spec,
            current.quantity_mt,
            current.buyer_ceiling,
            current.ceiling_state,
            current.currency,
            current.standing,
            current.expires_at,
          ],
        );
      await client.query(
        "insert into qualification_decisions(id,organization_id,subject_type,subject_id,subject_version,verdict,reasons,policy_version,decided_at) values($1,$2,$3,$4,$5,'PASS','[]'::jsonb,$6,now())",
        [
          randomUUID(),
          subject.organization_id,
          subject.subject_type,
          subject.id,
          next,
          policyVersion,
        ],
      );
      const outbox = new TransactionalOutboxRepository(this.pool),
        eventType =
          subject.subject_type === "SUPPLIER_OFFER"
            ? "OFFER_VERSION_ADDED"
            : "DEMAND_VERSION_ADDED";
      await outbox.append(client, {
        id: randomUUID(),
        aggregateType: subject.subject_type,
        aggregateId: subject.id,
        eventType,
        payload: { version: next, qualificationPolicyVersion: policyVersion },
        idempotencyKey: `${eventType}:${subject.id}:${next}`,
      });
      return 1;
    });
  }
}
