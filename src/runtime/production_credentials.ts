import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { inTransaction } from "./database.js";

export type ProductionCredentialCapability =
  | "SETTLEMENT_API"
  | "SETTLEMENT_WEBHOOK"
  | "BANK_WEBHOOK"
  | "GMAIL_OAUTH"
  | "CONTACT_ENRICHMENT_API"
  | "SEARCH_API"
  | "COMMERCIAL_EXTRACTION_API"
  | "DOCUMENT_EXTRACTION_API"
  | "DOCUMENT_VERIFICATION_API"
  | "KYB_API"
  | "ECONOMIC_QUOTE_API";

export function credentialFingerprint(parts: readonly string[]): string {
  if (
    !parts.length ||
    parts.some(
      (value) =>
        typeof value !== "string" ||
        !value.trim() ||
        value.length > 32_768 ||
        /[\u0000]/.test(value),
    )
  )
    throw new Error("production credential material invalid");
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export interface CurrentCredentialBinding {
  readonly id: string;
  readonly verifiedAt: string;
  readonly validUntil: string;
}

export interface CredentialUseGuard {
  assertCurrent(): Promise<CurrentCredentialBinding>;
}

export class DatabaseCredentialUseGuard implements CredentialUseGuard {
  constructor(
    readonly pool: Pick<Pool, "query">,
    readonly input: {
      provider: string;
      capability: ProductionCredentialCapability;
      environment: "PRODUCTION";
      credentialParts: readonly string[];
    },
  ) {}
  assertCurrent(): Promise<CurrentCredentialBinding> {
    return assertCurrentCredentialBinding(this.pool, this.input);
  }
}

export async function assertCurrentCredentialBinding(
  pool: Pick<Pool, "query">,
  input: {
    provider: string;
    capability: ProductionCredentialCapability;
    environment: "PRODUCTION";
    credentialParts: readonly string[];
  },
): Promise<CurrentCredentialBinding> {
  if (!input.provider.trim()) throw new Error("credential provider missing");
  const fingerprint = credentialFingerprint(input.credentialParts),
    result = await pool.query(
      "select b.id,b.verified_at,b.valid_until from production_credential_bindings b join authority_receipts a on a.receipt_id=b.verification_receipt_id left join production_credential_revocations r on r.credential_binding_id=b.id where b.provider=$1 and b.capability=$2 and b.environment=$3 and b.credential_fingerprint=$4 and b.verified_at<=now() and b.valid_until>now() and a.authority_kind='PRODUCTION_CREDENTIAL_VERIFICATION' and a.retrieved_at<=now() and a.effective_at<=now() and a.expires_at>now() and r.id is null order by b.verified_at desc limit 1",
      [input.provider, input.capability, input.environment, fingerprint],
    );
  const row = result.rows[0];
  if (!row)
    throw new Error(
      `current production credential binding unavailable:${input.provider}:${input.capability}`,
    );
  return Object.freeze({
    id: String(row.id),
    verifiedAt: new Date(row.verified_at).toISOString(),
    validUntil: new Date(row.valid_until).toISOString(),
  });
}

export class ProductionCredentialRegistry {
  constructor(readonly pool: Pool) {}

  async register(input: {
    provider: string;
    capability: ProductionCredentialCapability;
    credentialParts: readonly string[];
    verificationReceiptId: string;
    verifiedAt: string;
    validUntil: string;
  }): Promise<Readonly<{ id: string; fingerprint: string }>> {
    const fingerprint = credentialFingerprint(input.credentialParts);
    if (
      !input.provider.trim() ||
      Number.isNaN(Date.parse(input.verifiedAt)) ||
      Date.parse(input.validUntil) <= Date.parse(input.verifiedAt)
    )
      throw new Error("production credential binding invalid");
    return inTransaction(this.pool, async (client) => {
      const receipt = (
        await client.query(
          "select 1 from authority_receipts where receipt_id=$1 and authority_kind='PRODUCTION_CREDENTIAL_VERIFICATION' and retrieved_at<=$2 and effective_at<=$2 and expires_at>$2",
          [input.verificationReceiptId, input.verifiedAt],
        )
      ).rows[0];
      if (!receipt)
        throw new Error("credential verification receipt unavailable");
      const prior = (
        await client.query(
          "select id from production_credential_bindings where provider=$1 and capability=$2 and environment='PRODUCTION' and credential_fingerprint=$3",
          [input.provider, input.capability, fingerprint],
        )
      ).rows[0];
      if (prior) return Object.freeze({ id: String(prior.id), fingerprint });
      const id = randomUUID();
      await client.query(
        "insert into production_credential_bindings(id,provider,capability,environment,credential_fingerprint,verification_receipt_id,verified_at,valid_until) values($1,$2,$3,'PRODUCTION',$4,$5,$6,$7)",
        [
          id,
          input.provider,
          input.capability,
          fingerprint,
          input.verificationReceiptId,
          input.verifiedAt,
          input.validUntil,
        ],
      );
      return Object.freeze({ id, fingerprint });
    });
  }

  async revoke(input: {
    bindingId: string;
    revocationReceiptId: string;
    reason: string;
    revokedAt: string;
  }): Promise<string> {
    if (!input.reason.trim() || Number.isNaN(Date.parse(input.revokedAt)))
      throw new Error("production credential revocation invalid");
    return inTransaction(this.pool, async (client) => {
      const binding = (
        await client.query(
          "select verified_at from production_credential_bindings where id=$1",
          [input.bindingId],
        )
      ).rows[0];
      if (
        !binding ||
        Date.parse(input.revokedAt) < Date.parse(binding.verified_at)
      )
        throw new Error("credential binding missing or revocation predates it");
      if (
        !(
          await client.query(
            "select 1 from authority_receipts where receipt_id=$1 and authority_kind='PRODUCTION_CREDENTIAL_REVOCATION' and retrieved_at<=$2 and effective_at<=$2 and expires_at>$2",
            [input.revocationReceiptId, input.revokedAt],
          )
        ).rowCount
      )
        throw new Error("credential revocation receipt unavailable");
      const prior = (
        await client.query(
          "select id from production_credential_revocations where credential_binding_id=$1",
          [input.bindingId],
        )
      ).rows[0];
      if (prior) return String(prior.id);
      const id = randomUUID();
      await client.query(
        "insert into production_credential_revocations(id,credential_binding_id,revocation_receipt_id,reason,revoked_at) values($1,$2,$3,$4,$5)",
        [
          id,
          input.bindingId,
          input.revocationReceiptId,
          input.reason.trim(),
          input.revokedAt,
        ],
      );
      return id;
    });
  }
}
