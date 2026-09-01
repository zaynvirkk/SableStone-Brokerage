import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { AgreementKind } from "../agreements.js";
import type {
  EvidenceReceipt,
  ImmutableEvidenceStore,
} from "./object_store.js";
import { inTransaction, TransactionalOutboxRepository } from "./database.js";

export type AgreementResourceType = "ORG_MASTER" | "MATCH" | "TRADE";
export type AgreementRole = "SUPPLIER" | "BUYER";
const AGREEMENT_SCOPE: Readonly<
  Record<
    AgreementKind,
    readonly [AgreementResourceType, readonly AgreementRole[]]
  >
> = Object.freeze({
  SUPPLIER_MASTER_BROKERAGE: ["ORG_MASTER", ["SUPPLIER"]],
  BUYER_ACCESS_TERMS: ["ORG_MASTER", ["BUYER"]],
  PROTECTED_ACCOUNT_NOTICE: ["MATCH", ["SUPPLIER"]],
  PROTECTED_SUPPLIER_ACKNOWLEDGEMENT: ["MATCH", ["BUYER"]],
  TRANSACTION_CONFIRMATION: ["TRADE", ["SUPPLIER", "BUYER"]],
  SETTLEMENT_INSTRUCTIONS: ["TRADE", ["SUPPLIER", "BUYER"]],
});

export function agreementApprovalBindingSha256(input: {
  agreementId: string;
  version: string;
  kind: AgreementKind;
  bodySha256: string;
  resourceType: AgreementResourceType;
  resourceId: string;
  expectedOrganizationId: string;
  role: AgreementRole;
  effectiveAt: string;
  expiresAt: string;
}): string {
  const scope = AGREEMENT_SCOPE[input.kind];
  if (
    !scope ||
    scope[0] !== input.resourceType ||
    !scope[1].includes(input.role)
  )
    throw new Error("agreement kind resource scope invalid");
  if (
    !/^[0-9a-f-]{36}$/i.test(input.agreementId) ||
    !/^[0-9a-f]{64}$/.test(input.bodySha256) ||
    !input.version.trim() ||
    Number.isNaN(Date.parse(input.effectiveAt)) ||
    Date.parse(input.expiresAt) <= Date.parse(input.effectiveAt)
  )
    throw new Error("agreement approval binding invalid");
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...input,
        effectiveAt: new Date(input.effectiveAt).toISOString(),
        expiresAt: new Date(input.expiresAt).toISOString(),
      }),
    )
    .digest("hex");
}

export class AgreementRegistry {
  readonly outbox: TransactionalOutboxRepository;
  constructor(
    readonly pool: Pool,
    readonly store: ImmutableEvidenceStore,
  ) {
    this.outbox = new TransactionalOutboxRepository(pool);
  }

  async register(input: {
    agreementId: string;
    version: string;
    kind: AgreementKind;
    legalGateReceiptId: string;
    resourceType: AgreementResourceType;
    resourceId: string;
    expectedOrganizationId: string;
    role: AgreementRole;
    effectiveAt: string;
    expiresAt: string;
    registeredAt: string;
  }): Promise<
    Readonly<{
      agreementId: string;
      agreementBindingId: string;
      bodySha256: string;
      bindingSha256: string;
    }>
  > {
    if (
      !/^[0-9a-f-]{36}$/i.test(input.agreementId) ||
      !input.version.trim() ||
      input.version.length > 100 ||
      Number.isNaN(Date.parse(input.registeredAt)) ||
      Date.parse(input.effectiveAt) > Date.parse(input.registeredAt) ||
      Date.parse(input.expiresAt) <= Date.parse(input.registeredAt)
    )
      throw new Error("agreement registration validity invalid");
    const receipt = (
      await this.pool.query(
        "select * from authority_receipts where receipt_id=$1 and authority_kind='LEGAL_AGREEMENT_APPROVAL' and effective_at<=$2 and expires_at>$2 and retrieved_at<=$2",
        [input.legalGateReceiptId, input.registeredAt],
      )
    ).rows[0];
    if (
      !receipt ||
      Date.parse(input.expiresAt) > Date.parse(receipt.expires_at)
    )
      throw new Error("current exact legal agreement receipt missing");
    await this.store.readVerified(
      String(receipt.body_object_key),
      String(receipt.body_sha256),
    );
    const approvalBindingSha256 = agreementApprovalBindingSha256({
      agreementId: input.agreementId,
      version: input.version,
      kind: input.kind,
      bodySha256: receipt.body_sha256,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      expectedOrganizationId: input.expectedOrganizationId,
      role: input.role,
      effectiveAt: input.effectiveAt,
      expiresAt: input.expiresAt,
    });
    if (
      receipt.proposition !==
      `AGREEMENT_BINDING_SHA256:${approvalBindingSha256}`
    )
      throw new Error("legal receipt does not approve exact agreement binding");
    return inTransaction(this.pool, async (client) => {
      await assertResourceOwnership(
        client,
        input.resourceType,
        input.resourceId,
        input.expectedOrganizationId,
        input.role,
      );
      const priorAgreement = (
        await client.query(
          "select * from agreements where id=$1 and version=$2",
          [input.agreementId, input.version],
        )
      ).rows[0];
      if (
        priorAgreement &&
        (priorAgreement.agreement_kind !== input.kind ||
          priorAgreement.body_sha256 !== receipt.body_sha256 ||
          priorAgreement.body_object_key !== receipt.body_object_key ||
          new Date(priorAgreement.effective_at).toISOString() !==
            new Date(input.effectiveAt).toISOString() ||
          new Date(priorAgreement.expires_at).toISOString() !==
            new Date(input.expiresAt).toISOString())
      )
        throw new Error("agreement version conflict");
      if (!priorAgreement)
        await client.query(
          "insert into agreements(id,agreement_kind,version,body_sha256,body_object_key,effective_at,expires_at,legal_gate_receipt_id,seller_of_record,sablestone_role) values($1,$2,$3,$4,$5,$6,$7,$8,'SUPPLIER','COMMISSION_BROKER')",
          [
            input.agreementId,
            input.kind,
            input.version,
            receipt.body_sha256,
            receipt.body_object_key,
            input.effectiveAt,
            input.expiresAt,
            input.legalGateReceiptId,
          ],
        );
      const bindingSha256 = createHash("sha256")
          .update(
            JSON.stringify({
              agreementId: input.agreementId,
              version: input.version,
              bodySha256: receipt.body_sha256,
              resourceType: input.resourceType,
              resourceId: input.resourceId,
              expectedOrganizationId: input.expectedOrganizationId,
              role: input.role,
            }),
          )
          .digest("hex"),
        priorBinding = (
          await client.query(
            "select id,binding_sha256,legal_gate_receipt_id from agreement_resource_bindings where agreement_id=$1 and agreement_version=$2 and resource_type=$3 and resource_id=$4 and expected_organization_id=$5 and role=$6",
            [
              input.agreementId,
              input.version,
              input.resourceType,
              input.resourceId,
              input.expectedOrganizationId,
              input.role,
            ],
          )
        ).rows[0];
      if (priorBinding) {
        if (
          priorBinding.binding_sha256 !== bindingSha256 ||
          priorBinding.legal_gate_receipt_id !== input.legalGateReceiptId
        )
          throw new Error("agreement binding conflict");
        return Object.freeze({
          agreementId: input.agreementId,
          agreementBindingId: String(priorBinding.id),
          bodySha256: String(receipt.body_sha256),
          bindingSha256,
        });
      }
      const agreementBindingId = randomUUID();
      await client.query(
        "insert into agreement_resource_bindings(id,agreement_id,agreement_version,resource_type,resource_id,expected_organization_id,role,binding_sha256,legal_gate_receipt_id,agreement_kind) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          agreementBindingId,
          input.agreementId,
          input.version,
          input.resourceType,
          input.resourceId,
          input.expectedOrganizationId,
          input.role,
          bindingSha256,
          input.legalGateReceiptId,
          input.kind,
        ],
      );
      await this.outbox.append(client, {
        id: randomUUID(),
        aggregateType: "AGREEMENT",
        aggregateId: input.agreementId,
        eventType: "AGREEMENT_RESOURCE_BOUND",
        payload: {
          agreementId: input.agreementId,
          version: input.version,
          agreementBindingId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          expectedOrganizationId: input.expectedOrganizationId,
          role: input.role,
          bodySha256: receipt.body_sha256,
          bindingSha256,
          legalGateReceiptId: input.legalGateReceiptId,
        },
        idempotencyKey: `agreement-binding:${bindingSha256}`,
      });
      return Object.freeze({
        agreementId: input.agreementId,
        agreementBindingId,
        bodySha256: String(receipt.body_sha256),
        bindingSha256,
      });
    });
  }

  async registerRendered(input: {
    agreementId: string;
    version: string;
    kind: AgreementKind;
    templateLegalReceiptId: string;
    body: EvidenceReceipt;
    resourceType: AgreementResourceType;
    resourceId: string;
    expectedOrganizationId: string;
    role: AgreementRole;
    effectiveAt: string;
    expiresAt: string;
    registeredAt: string;
  }): Promise<
    Readonly<{
      agreementId: string;
      agreementBindingId: string;
      bodySha256: string;
      bindingSha256: string;
    }>
  > {
    if (
      !/^[0-9a-f-]{36}$/i.test(input.agreementId) ||
      !input.version.trim() ||
      Date.parse(input.effectiveAt) > Date.parse(input.registeredAt) ||
      Date.parse(input.expiresAt) <= Date.parse(input.registeredAt)
    )
      throw new Error("rendered agreement validity invalid");
    agreementApprovalBindingSha256({
      agreementId: input.agreementId,
      version: input.version,
      kind: input.kind,
      bodySha256: input.body.sha256,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      expectedOrganizationId: input.expectedOrganizationId,
      role: input.role,
      effectiveAt: input.effectiveAt,
      expiresAt: input.expiresAt,
    });
    const legal = (
      await this.pool.query(
        "select * from authority_receipts where receipt_id=$1 and authority_kind='LEGAL_AGREEMENT_TEMPLATE' and retrieved_at<=$2 and effective_at<=$2 and expires_at>$2",
        [input.templateLegalReceiptId, input.registeredAt],
      )
    ).rows[0];
    if (!legal || Date.parse(input.expiresAt) > Date.parse(legal.expires_at))
      throw new Error("current agreement template legal receipt missing");
    await this.store.readVerified(input.body.objectKey, input.body.sha256);
    return inTransaction(this.pool, async (client) => {
      await assertResourceOwnership(
        client,
        input.resourceType,
        input.resourceId,
        input.expectedOrganizationId,
        input.role,
      );
      const agreement = (
        await client.query(
          "select * from agreements where id=$1 and version=$2",
          [input.agreementId, input.version],
        )
      ).rows[0];
      if (agreement) throw new Error("rendered agreement id collision");
      await client.query(
        "insert into agreements(id,agreement_kind,version,body_sha256,body_object_key,effective_at,expires_at,legal_gate_receipt_id,seller_of_record,sablestone_role) values($1,$2,$3,$4,$5,$6,$7,$8,'SUPPLIER','COMMISSION_BROKER')",
        [
          input.agreementId,
          input.kind,
          input.version,
          input.body.sha256,
          input.body.objectKey,
          input.effectiveAt,
          input.expiresAt,
          input.templateLegalReceiptId,
        ],
      );
      const bindingSha256 = createHash("sha256")
          .update(
            JSON.stringify({
              agreementId: input.agreementId,
              version: input.version,
              bodySha256: input.body.sha256,
              resourceType: input.resourceType,
              resourceId: input.resourceId,
              expectedOrganizationId: input.expectedOrganizationId,
              role: input.role,
            }),
          )
          .digest("hex"),
        agreementBindingId = randomUUID();
      await client.query(
        "insert into agreement_resource_bindings(id,agreement_id,agreement_version,resource_type,resource_id,expected_organization_id,role,binding_sha256,legal_gate_receipt_id,agreement_kind) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          agreementBindingId,
          input.agreementId,
          input.version,
          input.resourceType,
          input.resourceId,
          input.expectedOrganizationId,
          input.role,
          bindingSha256,
          input.templateLegalReceiptId,
          input.kind,
        ],
      );
      await this.outbox.append(client, {
        id: randomUUID(),
        aggregateType: "AGREEMENT",
        aggregateId: input.agreementId,
        eventType: "AGREEMENT_RESOURCE_BOUND",
        payload: {
          agreementId: input.agreementId,
          version: input.version,
          agreementBindingId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          expectedOrganizationId: input.expectedOrganizationId,
          role: input.role,
          bodySha256: input.body.sha256,
          bindingSha256,
          legalGateReceiptId: input.templateLegalReceiptId,
          generatedFromTemplate: true,
        },
        idempotencyKey: `agreement-binding:${bindingSha256}`,
      });
      return Object.freeze({
        agreementId: input.agreementId,
        agreementBindingId,
        bodySha256: input.body.sha256,
        bindingSha256,
      });
    });
  }
}

async function assertResourceOwnership(
  client: PoolClient,
  resourceType: AgreementResourceType,
  resourceId: string,
  organizationId: string,
  role: AgreementRole,
): Promise<void> {
  let row: QueryResultRow | undefined;
  if (resourceType === "ORG_MASTER")
    row = (
      await client.query(
        "select id,organization_type from organizations where id=$1",
        [resourceId],
      )
    ).rows[0];
  else if (resourceType === "MATCH")
    row = (
      await client.query(
        "select o.supplier_id,d.buyer_id from matches m join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version where m.id=$1 and m.compatible",
        [resourceId],
      )
    ).rows[0];
  else
    row = (
      await client.query(
        "select supplier_id,buyer_id from trades where id=$1",
        [resourceId],
      )
    ).rows[0];
  const expected =
    resourceType === "ORG_MASTER"
      ? row?.id
      : role === "SUPPLIER"
        ? row?.supplier_id
        : row?.buyer_id;
  const roleMatches =
    resourceType !== "ORG_MASTER" || row?.organization_type === role;
  if (
    !row ||
    expected !== organizationId ||
    resourceId !==
      (resourceType === "ORG_MASTER" ? organizationId : resourceId) ||
    !roleMatches
  )
    throw new Error("agreement resource ownership mismatch");
}
