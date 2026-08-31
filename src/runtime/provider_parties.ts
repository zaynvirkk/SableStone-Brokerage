import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { SensitiveDataCipher } from "./sensitive_data.js";

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
          "select * from provider_party_accounts where id=$1",
          [boundId],
        )
      : await client.query(
          "select * from provider_party_accounts where provider=$1 and organization_id=$2 and party_role=$3 and revoked_at is null and verified_at <= $4 and valid_until > $4 order by verified_at desc limit 1",
          [provider, organizationId, role, now],
        );
    const row = result.rows[0];
    if (
      !row ||
      row.provider !== provider ||
      row.organization_id !== organizationId ||
      row.party_role !== role ||
      row.revoked_at ||
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
    return {
      id: String(row.id),
      payload: Object.freeze(payload as Record<string, string>),
    };
  }
}
