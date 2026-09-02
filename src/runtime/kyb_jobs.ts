import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  ConsolidatedScreeningListConnector,
  ProductionKybConnector,
  type KybProviderConfig,
} from "../connectors/kyb.js";
import type { ImmutableEvidenceStore } from "./object_store.js";
import { inTransaction } from "./database.js";
import { assertCurrentAuthorityReceipt } from "./authority_receipts.js";
import { DatabaseAuthorityUseGuard } from "./authority_receipts.js";
import {
  assertCurrentCredentialBinding,
  DatabaseCredentialUseGuard,
} from "./production_credentials.js";
import { createPinnedPublicFetch } from "./public_network.js";
interface KybRuntimeConfig extends KybProviderConfig {
  readonly authorityReceiptId: string;
  readonly cslEndpoint: string;
  readonly policyVersion: string;
}
export async function buildProductionKyb(
  pool: Pool,
  store: ImmutableEvidenceStore,
  serialized: string | undefined,
): Promise<{
  kyb: ProductionKybConnector;
  csl: ConsolidatedScreeningListConnector;
  config: KybRuntimeConfig;
} | null> {
  if (!serialized) return null;
  const config = JSON.parse(serialized) as KybRuntimeConfig;
  await assertCurrentAuthorityReceipt(
    pool,
    config.authorityReceiptId,
    "KYB_PROVIDER_APPROVAL",
  );
  const credentialInput = {
    provider: config.provider,
    capability: "KYB_API",
    environment: "PRODUCTION",
    credentialParts: [config.authorizationHeader],
  } as const;
  await assertCurrentCredentialBinding(pool, credentialInput);
  return {
    kyb: new ProductionKybConnector(
      config,
      store,
      createPinnedPublicFetch(),
      new DatabaseCredentialUseGuard(pool, credentialInput),
      new DatabaseAuthorityUseGuard(
        pool,
        config.authorityReceiptId,
        "KYB_PROVIDER_APPROVAL",
      ),
    ),
    csl: new ConsolidatedScreeningListConnector(config.cslEndpoint, store),
    config,
  };
}
export class KybJobDispatcher {
  constructor(
    readonly pool: Pool,
    readonly runtime: NonNullable<
      Awaited<ReturnType<typeof buildProductionKyb>>
    >,
  ) {}
  async dispatchBatch(limit = 10): Promise<number> {
    const jobs = await inTransaction(
      this.pool,
      async (client) =>
        (
          await client.query(
            "with claimed as(select id from kyb_jobs where state='PENDING' or(state='PROCESSING' and claimed_at<now()-interval '10 minutes') order by created_at for update skip locked limit $1) update kyb_jobs j set state='PROCESSING',attempts=attempts+1,claimed_at=now() from claimed where j.id=claimed.id returning j.*",
            [limit],
          )
        ).rows,
    );
    let completed = 0;
    for (const job of jobs) {
      try {
        const candidate = (
          await this.pool.query(
            "select legal_name,registration_identifier from organization_candidates where id=$1",
            [job.candidate_id],
          )
        ).rows[0];
        if (!candidate) throw new Error("KYB candidate missing");
        const now = new Date().toISOString(),
          [kyb, csl] = await Promise.all([
            this.runtime.kyb.verify(
              {
                organizationName: candidate.legal_name,
                countryCode: job.country_code,
                registrationIdentifier: candidate.registration_identifier,
              },
              now,
            ),
            this.runtime.csl.screen(candidate.legal_name, now),
          ]);
        await inTransaction(this.pool, async (client) => {
          const receipts = [];
          for (const check of [
            {
              type: "KYB_IDENTITY",
              state:
                kyb.outcome === "VERIFIED" && !kyb.watchlistHit
                  ? "PASS"
                  : kyb.outcome === "FAILED" || kyb.watchlistHit
                    ? "HIT"
                    : "UNKNOWN",
              provider: kyb.provider,
              receipt: kyb.receiptId,
              digest: kyb.receiptId.split("/").at(-1),
              matches:
                kyb.outcome === "VERIFIED" ? [kyb.externalReference] : [],
            },
            {
              type: "SANCTIONS",
              state:
                csl.state === "CLEAR"
                  ? "PASS"
                  : csl.state === "POTENTIAL_HIT"
                    ? "HIT"
                    : "UNKNOWN",
              provider: "US_CSL",
              receipt: csl.receiptId,
              digest: csl.receiptId.split("/").at(-1),
              matches: csl.matches ? [String(csl.matches)] : [],
            },
          ]) {
            if (!check.digest || !/^[0-9a-f]{64}$/.test(check.digest))
              throw new Error("risk receipt digest invalid");
            let evidence = (
              await client.query(
                "select id from external_evidence_receipts where object_key=$1",
                [check.receipt],
              )
            ).rows[0];
            if (!evidence)
              evidence = (
                await client.query(
                  "insert into external_evidence_receipts(id,provider,object_key,sha256) values($1,$2,$3,$4) returning id",
                  [randomUUID(), check.provider, check.receipt, check.digest],
                )
              ).rows[0];
            const id = randomUUID();
            await client.query(
              "insert into risk_checks(id,organization_id,check_type,state,source_provider,source_receipt_id,source_digest,checked_at,valid_until,matched_entity_ids,policy_version) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(organization_id,check_type,source_provider,source_digest,policy_version) do nothing",
              [
                id,
                job.organization_id,
                check.type,
                check.state,
                check.provider,
                evidence.id,
                check.digest,
                now,
                new Date(Date.parse(now) + 30 * 86400_000).toISOString(),
                check.matches,
                this.runtime.config.policyVersion,
              ],
            );
            receipts.push({ id, state: check.state, type: check.type });
          }
          const state = receipts.every((value) => value.state === "PASS")
            ? "PASS"
            : receipts.some((value) => value.state === "HIT")
              ? "REJECT"
              : "FREEZE";
          const identityCheck = receipts.find(
            (value) => value.type === "KYB_IDENTITY" && value.state === "PASS",
          );
          if (state === "PASS" && identityCheck)
            await client.query(
              "update organization_jurisdictions set state='VERIFIED',verified_risk_check_id=$2,valid_until=$3 where organization_id=$1 and country_code=$4",
              [
                job.organization_id,
                identityCheck.id,
                new Date(Date.parse(now) + 30 * 86400_000).toISOString(),
                job.country_code,
              ],
            );
          await client.query(
            "insert into risk_decisions(id,organization_id,state,reasons,check_ids,policy_version,decided_at) values($1,$2,$3,$4,$5,$6,$7)",
            [
              randomUUID(),
              job.organization_id,
              state,
              receipts
                .filter((value) => value.state !== "PASS")
                .map((value) => `${value.type}:${value.state}`),
              receipts.map((value) => value.id),
              this.runtime.config.policyVersion,
              now,
            ],
          );
          await client.query(
            "update kyb_jobs set state=$2,completed_at=now(),claimed_at=null where id=$1 and state='PROCESSING'",
            [job.id, state === "PASS" ? "COMPLETED" : "REJECTED"],
          );
          await client.query(
            "update acquisition_outreach_jobs set state=case when $2='PASS' then 'READY' when $2='REJECT' then 'SUPPRESSED' else 'WAITING_RISK' end,completed_at=case when $2='REJECT' then now() else null end,claimed_at=null,last_error_code=case when $2='PASS' then null when $2='REJECT' then 'COUNTERPARTY_RISK_REJECTED' else 'RISK_EVIDENCE_PENDING' end where organization_id=$1 and state='WAITING_RISK'",
            [job.organization_id, state],
          );
        });
        completed++;
      } catch (error) {
        const unavailable = /capability unavailable/i.test(
          (error as Error).message,
        );
        await this.pool.query(
          "update kyb_jobs set state=case when $2 then 'UNAVAILABLE' when attempts>=5 then 'FAILED' else 'PENDING' end,completed_at=case when $2 or attempts>=5 then now() else null end,claimed_at=null,last_error_code=$3 where id=$1 and state='PROCESSING'",
          [job.id, unavailable, (error as Error).name.slice(0, 100)],
        );
      }
    }
    return completed;
  }
}
