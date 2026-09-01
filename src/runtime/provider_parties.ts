import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { SensitiveDataCipher } from "./sensitive_data.js";
import { inTransaction, TransactionalOutboxRepository } from "./database.js";

export type ProviderPartyRole = "BUYER" | "SUPPLIER" | "SABLESTONE";
const PROVIDER_REFERENCE_SCHEMA: Readonly<
  Record<string, Readonly<Record<ProviderPartyRole, readonly string[]>>>
> = Object.freeze({
  ESCROW_COM: Object.freeze({
    BUYER: ["customer"],
    SUPPLIER: ["customer"],
    SABLESTONE: ["customer"],
  }),
  CASHFREE: Object.freeze({
    BUYER: ["customer_email", "customer_id", "customer_name", "customer_phone"],
    SUPPLIER: ["vendor_id"],
    SABLESTONE: ["merchant_id"],
  }),
  CASHFREE_EASY_SPLIT: Object.freeze({
    BUYER: ["customer_email", "customer_id", "customer_name", "customer_phone"],
    SUPPLIER: ["vendor_id"],
    SABLESTONE: ["merchant_id"],
  }),
  RAZORPAY_ROUTE: Object.freeze({
    BUYER: ["customer_id"],
    SUPPLIER: ["linked_account_id"],
    SABLESTONE: ["merchant_account_id"],
  }),
  INDIAN_BANK_ESCROW: Object.freeze({
    BUYER: ["payer_id"],
    SUPPLIER: ["beneficiary_id"],
    SABLESTONE: ["beneficiary_id"],
  }),
  LC_PROCEEDS: Object.freeze({
    BUYER: ["applicant_id"],
    SUPPLIER: ["credit_beneficiary_id"],
    SABLESTONE: ["assignee_id"],
  }),
});

export function canonicalProviderPartyPayload(
  provider: string,
  role: ProviderPartyRole,
  input: Readonly<Record<string, unknown>>,
): string {
  const required = PROVIDER_REFERENCE_SCHEMA[provider]?.[role];
  if (!required) throw new Error("unsupported provider party schema");
  const keys = Object.keys(input).sort();
  if (
    keys.length !== required.length ||
    keys.some((key, index) => key !== [...required].sort()[index])
  )
    throw new Error("provider party reference fields invalid");
  const normalized: Record<string, string> = {};
  for (const key of [...required].sort()) {
    const value = input[key];
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 500 ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      throw new Error(`provider party reference invalid:${key}`);
    normalized[key] = value.trim();
  }
  if (
    normalized.customer_email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.customer_email)
  )
    throw new Error("provider customer email invalid");
  if (
    normalized.customer_phone &&
    !/^\+?[0-9]{8,15}$/.test(normalized.customer_phone)
  )
    throw new Error("provider customer phone invalid");
  return JSON.stringify(normalized);
}

export class ProviderPartyAccountRegistry {
  readonly outbox: TransactionalOutboxRepository;
  constructor(
    readonly pool: Pool,
    readonly cipher: SensitiveDataCipher,
  ) {
    this.outbox = new TransactionalOutboxRepository(pool);
  }

  async register(input: {
    provider: string;
    organizationId: string;
    role: ProviderPartyRole;
    references: Readonly<Record<string, unknown>>;
    verificationReceiptId: string;
    validUntil: string;
    registeredAt: string;
  }): Promise<Readonly<{ id: string; referenceSha256: string }>> {
    const canonical = canonicalProviderPartyPayload(
        input.provider,
        input.role,
        input.references,
      ),
      referenceSha256 = createHash("sha256").update(canonical).digest("hex");
    if (
      Number.isNaN(Date.parse(input.registeredAt)) ||
      Date.parse(input.validUntil) <= Date.parse(input.registeredAt)
    )
      throw new Error("provider party validity invalid");
    return inTransaction(this.pool, async (client) => {
      const organization = (
        await client.query(
          "select organization_type from organizations where id=$1",
          [input.organizationId],
        )
      ).rows[0];
      if (!organization || organization.organization_type !== input.role)
        throw new Error("provider party organization role mismatch");
      const approval = (
        await client.query(
          "select pa.id from provider_approvals pa join authority_receipts ar on ar.receipt_id=pa.written_approval_receipt_id where pa.provider=$1 and pa.environment='PRODUCTION' and pa.state='APPROVED' and pa.valid_from<=$2 and pa.valid_until>$2 and ar.authority_kind='PROVIDER_WRITTEN_APPROVAL' and ar.effective_at<=$2 and ar.expires_at>$2 order by pa.valid_from desc limit 1",
          [input.provider, input.registeredAt],
        )
      ).rows[0];
      if (!approval)
        throw new Error("current production provider approval missing");
      const evidence = (
        await client.query(
          "select receipt_id from authority_receipts where receipt_id=$1 and authority_kind='PROVIDER_ACCOUNT_VERIFICATION' and effective_at<=$2 and expires_at>$2 and retrieved_at<=$2",
          [input.verificationReceiptId, input.registeredAt],
        )
      ).rows[0];
      if (!evidence)
        throw new Error(
          "current provider account verification receipt missing",
        );
      const prior = (
        await client.query(
          "select id from provider_party_accounts where provider=$1 and organization_id=$2 and party_role=$3 and reference_sha256=$4",
          [input.provider, input.organizationId, input.role, referenceSha256],
        )
      ).rows[0];
      if (prior)
        return Object.freeze({ id: String(prior.id), referenceSha256 });
      const collision = (
        await client.query(
          "select 1 from provider_party_accounts where provider=$1 and party_role=$2 and reference_sha256=$3",
          [input.provider, input.role, referenceSha256],
        )
      ).rowCount;
      if (collision)
        throw new Error(
          "provider external identity already belongs to another organization",
        );
      const id = randomUUID();
      await client.query(
        "insert into provider_party_accounts(id,provider,organization_id,party_role,reference_ciphertext,reference_sha256,verification_receipt_id,verified_at,valid_until) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          id,
          input.provider,
          input.organizationId,
          input.role,
          this.cipher.encrypt(canonical),
          referenceSha256,
          input.verificationReceiptId,
          input.registeredAt,
          input.validUntil,
        ],
      );
      await this.outbox.append(client, {
        id: randomUUID(),
        aggregateType: "PROVIDER_PARTY_ACCOUNT",
        aggregateId: id,
        eventType: "PROVIDER_PARTY_ACCOUNT_REGISTERED",
        payload: {
          provider: input.provider,
          organizationId: input.organizationId,
          role: input.role,
          referenceSha256,
          verificationReceiptId: input.verificationReceiptId,
          validUntil: input.validUntil,
        },
        idempotencyKey: `provider-party:${input.provider}:${input.role}:${referenceSha256}`,
      });
      return Object.freeze({ id, referenceSha256 });
    });
  }

  async revoke(input: {
    id: string;
    authorityReceiptId: string;
    reason: string;
    revokedAt: string;
  }): Promise<string> {
    if (!input.reason.trim() || Number.isNaN(Date.parse(input.revokedAt)))
      throw new Error("provider party revocation invalid");
    return inTransaction(this.pool, async (client) => {
      const account = (
        await client.query(
          "select verified_at from provider_party_accounts where id=$1",
          [input.id],
        )
      ).rows[0];
      if (
        !account ||
        Date.parse(input.revokedAt) < Date.parse(account.verified_at)
      )
        throw new Error(
          "provider party account missing or revocation predates registration",
        );
      if (
        !(
          await client.query(
            "select 1 from authority_receipts where receipt_id=$1 and authority_kind='PROVIDER_ACCOUNT_REVOCATION' and effective_at<=$2 and expires_at>$2 and retrieved_at<=$2",
            [input.authorityReceiptId, input.revokedAt],
          )
        ).rowCount
      )
        throw new Error("current provider account revocation receipt missing");
      const prior = (
        await client.query(
          "select id from provider_party_account_revocations where provider_party_account_id=$1",
          [input.id],
        )
      ).rows[0];
      if (prior) return String(prior.id);
      const revocationId = randomUUID();
      await client.query(
        "insert into provider_party_account_revocations(id,provider_party_account_id,authority_receipt_id,reason,revoked_at) values($1,$2,$3,$4,$5)",
        [
          revocationId,
          input.id,
          input.authorityReceiptId,
          input.reason.trim(),
          input.revokedAt,
        ],
      );
      await this.outbox.append(client, {
        id: randomUUID(),
        aggregateType: "PROVIDER_PARTY_ACCOUNT",
        aggregateId: input.id,
        eventType: "PROVIDER_PARTY_ACCOUNT_REVOKED",
        payload: {
          revocationId,
          authorityReceiptId: input.authorityReceiptId,
          revokedAt: input.revokedAt,
        },
        idempotencyKey: `provider-party:${input.id}:revoked`,
      });
      return revocationId;
    });
  }
}

export interface ProviderPartyReferences {
  readonly buyer: Readonly<Record<string, string>>;
  readonly supplier: Readonly<Record<string, string>>;
  readonly sablestone: Readonly<Record<string, string>>;
  readonly mappingIds: Readonly<{
    buyer: string;
    supplier: string;
    sablestone: string;
  }>;
}

export class ProviderPartyReferenceResolver {
  constructor(
    readonly pool: Pool,
    readonly cipher: SensitiveDataCipher,
  ) {}

  async resolveAndBind(
    instruction: QueryResultRow,
    now: string,
  ): Promise<ProviderPartyReferences> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const locked = (
        await client.query(
          "select * from settlement_instructions where id=$1 for update",
          [instruction.id],
        )
      ).rows[0];
      if (!locked) throw new Error("settlement instruction missing");
      const references = await this.resolveWithClient(client, locked, now);
      await client.query(
        "update settlement_instructions set provider_buyer_party_account_id=coalesce(provider_buyer_party_account_id,$2),provider_supplier_party_account_id=coalesce(provider_supplier_party_account_id,$3),provider_sablestone_party_account_id=coalesce(provider_sablestone_party_account_id,$4) where id=$1",
        [
          locked.id,
          references.mappingIds.buyer,
          references.mappingIds.supplier,
          references.mappingIds.sablestone,
        ],
      );
      await client.query("commit");
      return references;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Revalidates the exact accounts already bound to an instruction inside the
   * caller's transaction. This closes the revocation/expiry race between an
   * external provider call and entitlement promotion. */
  async resolveBoundCurrent(
    client: PoolClient,
    instruction: QueryResultRow,
    now: string,
  ): Promise<ProviderPartyReferences> {
    if (
      !instruction.provider_buyer_party_account_id ||
      !instruction.provider_supplier_party_account_id ||
      !instruction.provider_sablestone_party_account_id
    )
      throw new Error("settlement provider parties are not fully bound");
    return this.resolveWithClient(client, instruction, now);
  }

  private async resolveWithClient(
    client: PoolClient,
    instruction: QueryResultRow,
    now: string,
  ): Promise<ProviderPartyReferences> {
    const entries = await Promise.all([
      this.one(
        client,
        instruction.provider_buyer_party_account_id,
        instruction.provider,
        instruction.buyer_id,
        "BUYER",
        now,
      ),
      this.one(
        client,
        instruction.provider_supplier_party_account_id,
        instruction.provider,
        instruction.supplier_id,
        "SUPPLIER",
        now,
      ),
      this.one(
        client,
        instruction.provider_sablestone_party_account_id,
        instruction.provider,
        instruction.sablestone_beneficiary_id,
        "SABLESTONE",
        now,
      ),
    ]);
    return Object.freeze({
      buyer: entries[0].payload,
      supplier: entries[1].payload,
      sablestone: entries[2].payload,
      mappingIds: Object.freeze({
        buyer: entries[0].id,
        supplier: entries[1].id,
        sablestone: entries[2].id,
      }),
    });
  }

  private async one(
    client: PoolClient,
    boundId: string | null,
    provider: string,
    organizationId: string,
    role: string,
    now: string,
  ) {
    const result = boundId
      ? await client.query(
          "select p.*,r.revoked_at registry_revoked_at,a.authority_kind verification_authority_kind,a.effective_at verification_effective_at,a.expires_at verification_expires_at from provider_party_accounts p join authority_receipts a on a.receipt_id=p.verification_receipt_id left join provider_party_account_revocations r on r.provider_party_account_id=p.id where p.id=$1",
          [boundId],
        )
      : await client.query(
          "select p.*,r.revoked_at registry_revoked_at,a.authority_kind verification_authority_kind,a.effective_at verification_effective_at,a.expires_at verification_expires_at from provider_party_accounts p join authority_receipts a on a.receipt_id=p.verification_receipt_id left join provider_party_account_revocations r on r.provider_party_account_id=p.id where p.provider=$1 and p.organization_id=$2 and p.party_role=$3 and p.revoked_at is null and r.id is null and p.verified_at <= $4 and p.valid_until > $4 and a.authority_kind='PROVIDER_ACCOUNT_VERIFICATION' and a.effective_at <= $4 and a.expires_at > $4 order by p.verified_at desc limit 1",
          [provider, organizationId, role, now],
        );
    const row = result.rows[0];
    if (
      !row ||
      row.provider !== provider ||
      row.organization_id !== organizationId ||
      row.party_role !== role ||
      row.revoked_at ||
      row.registry_revoked_at ||
      row.verification_authority_kind !== "PROVIDER_ACCOUNT_VERIFICATION" ||
      Date.parse(row.verification_effective_at) > Date.parse(now) ||
      Date.parse(row.verification_expires_at) <= Date.parse(now) ||
      Date.parse(row.verified_at) > Date.parse(now) ||
      Date.parse(row.valid_until) <= Date.parse(now) ||
      !String(row.verification_receipt_id).trim()
    )
      throw new Error(
        `current verified provider party mapping missing:${provider}:${role}`,
      );
    const plaintext = this.cipher.decrypt(row.reference_ciphertext),
      digest = createHash("sha256").update(plaintext).digest("hex");
    if (digest !== row.reference_sha256)
      throw new Error("provider party mapping digest mismatch");
    const payload = JSON.parse(plaintext) as Record<string, unknown>;
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.values(payload).some(
        (value) => typeof value !== "string" || !value.trim(),
      )
    )
      throw new Error("provider party mapping payload invalid");
    if (
      canonicalProviderPartyPayload(
        provider,
        role as ProviderPartyRole,
        payload,
      ) !== plaintext
    )
      throw new Error("provider party mapping schema mismatch");
    return {
      id: String(row.id),
      payload: Object.freeze(payload as Record<string, string>),
    };
  }
}
