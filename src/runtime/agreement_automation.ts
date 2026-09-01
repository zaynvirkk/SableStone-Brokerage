import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import type { AgreementKind } from "../agreements.js";
import type { ImmutableEvidenceStore } from "./object_store.js";
import {
  AgreementRegistry,
  agreementApprovalBindingSha256,
  type AgreementResourceType,
  type AgreementRole,
} from "./agreement_registry.js";

const ALLOWED_PLACEHOLDERS: Readonly<Record<AgreementKind, readonly string[]>> =
  Object.freeze({
    SUPPLIER_MASTER_BROKERAGE: [
      "agreement_id",
      "organization_id",
      "role",
      "version",
    ],
    BUYER_ACCESS_TERMS: ["agreement_id", "organization_id", "role", "version"],
    PROTECTED_ACCOUNT_NOTICE: [
      "agreement_id",
      "commission_currency",
      "commission_per_kg",
      "match_id",
      "product_family",
      "role",
      "version",
    ],
    PROTECTED_SUPPLIER_ACKNOWLEDGEMENT: [
      "agreement_id",
      "commission_currency",
      "commission_per_kg",
      "match_id",
      "product_family",
      "role",
      "version",
    ],
    TRANSACTION_CONFIRMATION: [
      "agreement_id",
      "buyer_id",
      "commission_currency",
      "commission_per_kg",
      "product_family",
      "role",
      "supplier_id",
      "trade_id",
      "version",
    ],
    SETTLEMENT_INSTRUCTIONS: [
      "agreement_id",
      "buyer_id",
      "commission_currency",
      "commission_per_kg",
      "product_family",
      "role",
      "supplier_id",
      "trade_id",
      "version",
    ],
  });

export function renderAgreementTemplate(
  kind: AgreementKind,
  template: string,
  facts: Readonly<Record<string, string>>,
): string {
  if (!template.trim() || Buffer.byteLength(template, "utf8") > 2_000_000)
    throw new Error("agreement template invalid");
  const found = [...template.matchAll(/\{\{([a-z_]+)\}\}/g)].map(
      (value) => value[1]!,
    ),
    unique = [...new Set(found)].sort(),
    allowed = ALLOWED_PLACEHOLDERS[kind];
  if (
    !allowed ||
    unique.some((name) => !allowed.includes(name)) ||
    Object.keys(facts).sort().join("\0") !== unique.join("\0")
  )
    throw new Error("agreement template placeholders invalid");
  let output = template;
  for (const name of unique) {
    const value = facts[name];
    if (
      value === undefined ||
      !value.trim() ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      throw new Error(`agreement template fact invalid:${name}`);
    output = output.replaceAll(`{{${name}}}`, value);
  }
  if (/\{\{[^}]+\}\}/.test(output))
    throw new Error("agreement template unresolved placeholder");
  return output;
}

export class AgreementAutomationDispatcher {
  readonly registry: AgreementRegistry;
  constructor(
    readonly pool: Pool,
    readonly store: ImmutableEvidenceStore,
  ) {
    this.registry = new AgreementRegistry(pool, store);
  }
  async dispatchBatch(limit = 25): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("agreement dispatch limit invalid");
    const rows = (
      await this.pool.query(
        "select m.id match_id,o.supplier_id,d.buyer_id,o.product_family,p.commission_per_kg,p.currency from matches m join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version join lateral(select commission_per_kg,currency from pricing_decisions where match_id=m.id and state='EXECUTABLE' order by calculated_at desc limit 1)p on true where m.compatible order by m.id limit $1",
        [limit],
      )
    ).rows;
    let completed = 0;
    for (const row of rows) completed += await this.ensureMatch(row);
    const trades = (
      await this.pool.query(
        "select t.id trade_id,t.supplier_id,t.buyer_id,o.product_family,pr.commission_rate commission_per_kg,pr.currency from trades t join protected_relationships pr on pr.id=t.relationship_id join matches m on m.id=t.match_id join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version where t.state in('IDENTITY_RELEASED','CONTRACTED','FUNDED') order by t.updated_at limit $1",
        [limit],
      )
    ).rows;
    for (const row of trades) completed += await this.ensureTrade(row);
    return completed;
  }
  private async ensureMatch(row: QueryResultRow) {
    let count = 0;
    for (const spec of [
      {
        kind: "SUPPLIER_MASTER_BROKERAGE",
        resourceType: "ORG_MASTER",
        resourceId: row.supplier_id,
        organizationId: row.supplier_id,
        role: "SUPPLIER",
      },
      {
        kind: "BUYER_ACCESS_TERMS",
        resourceType: "ORG_MASTER",
        resourceId: row.buyer_id,
        organizationId: row.buyer_id,
        role: "BUYER",
      },
      {
        kind: "PROTECTED_ACCOUNT_NOTICE",
        resourceType: "MATCH",
        resourceId: row.match_id,
        organizationId: row.supplier_id,
        role: "SUPPLIER",
      },
      {
        kind: "PROTECTED_SUPPLIER_ACKNOWLEDGEMENT",
        resourceType: "MATCH",
        resourceId: row.match_id,
        organizationId: row.buyer_id,
        role: "BUYER",
      },
    ] as const)
      count += await this.ensure(
        spec.kind,
        spec.resourceType,
        spec.resourceId,
        spec.organizationId,
        spec.role,
        row,
      );
    return count;
  }
  private async ensureTrade(row: QueryResultRow) {
    let count = 0;
    for (const kind of [
      "TRANSACTION_CONFIRMATION",
      "SETTLEMENT_INSTRUCTIONS",
    ] as const)
      for (const [role, organizationId] of [
        ["SUPPLIER", row.supplier_id],
        ["BUYER", row.buyer_id],
      ] as const)
        count += await this.ensure(
          kind,
          "TRADE",
          row.trade_id,
          organizationId,
          role,
          row,
        );
    return count;
  }
  private async ensure(
    kind: AgreementKind,
    resourceType: AgreementResourceType,
    resourceId: string,
    organizationId: string,
    role: AgreementRole,
    row: QueryResultRow,
  ) {
    if (
      (
        await this.pool.query(
          "select 1 from agreement_resource_bindings b join agreements a on a.id=b.agreement_id and a.version=b.agreement_version where a.agreement_kind=$1 and b.resource_type=$2 and b.resource_id=$3 and b.expected_organization_id=$4 and b.role=$5 and a.effective_at<=now() and a.expires_at>now()",
          [kind, resourceType, resourceId, organizationId, role],
        )
      ).rowCount
    )
      return 0;
    const template = (
      await this.pool.query(
        "select t.*,a.proposition,a.expires_at legal_expires_at from agreement_templates t join authority_receipts a on a.receipt_id=t.legal_gate_receipt_id where t.agreement_kind=$1 and t.resource_type=$2 and t.role=$3 and t.effective_at<=now() and t.expires_at>now() and a.authority_kind='LEGAL_AGREEMENT_TEMPLATE' and a.retrieved_at<=now() and a.effective_at<=now() and a.expires_at>now() order by t.effective_at desc limit 1",
        [kind, resourceType, role],
      )
    ).rows[0];
    if (!template) return 0;
    if (
      template.proposition !==
      `AGREEMENT_TEMPLATE:${kind}:${template.version}:${template.template_sha256}:RENDERER_V1`
    )
      throw new Error("agreement template legal approval mismatch");
    const bytes = await this.store.readVerified(
        template.template_object_key,
        template.template_sha256,
      ),
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      agreementId = randomUUID(),
      facts: Record<string, string> = {
        agreement_id: agreementId,
        version: template.version,
        role,
      };
    if (
      !Array.isArray(template.placeholder_names) ||
      template.placeholder_names.some(
        (name: unknown) => typeof name !== "string",
      )
    )
      throw new Error("agreement template placeholder registry invalid");
    for (const name of template.placeholder_names as string[]) {
      if (name in facts) continue;
      if (name === "organization_id") facts[name] = organizationId;
      else if (name === "match_id") facts[name] = String(row.match_id);
      else if (name === "trade_id") facts[name] = String(row.trade_id);
      else if (name === "product_family")
        facts[name] = String(row.product_family);
      else if (name === "commission_per_kg")
        facts[name] = String(row.commission_per_kg);
      else if (name === "commission_currency")
        facts[name] = String(row.currency);
      else if (name === "supplier_id") facts[name] = String(row.supplier_id);
      else if (name === "buyer_id") facts[name] = String(row.buyer_id);
      else throw new Error("agreement template fact unavailable");
    }
    const rendered = renderAgreementTemplate(kind, text, facts),
      receipt = await this.store.preserve(
        `agreements/generated/${kind}`,
        new TextEncoder().encode(rendered),
        "text/plain; charset=utf-8",
        `template:${template.id}`,
      ),
      now = new Date().toISOString(),
      expiresAt = new Date(
        Math.min(
          Date.parse(template.expires_at),
          Date.parse(template.legal_expires_at),
        ),
      ).toISOString();
    await this.registry.registerRendered({
      agreementId,
      version: template.version,
      kind,
      templateLegalReceiptId: template.legal_gate_receipt_id,
      body: receipt,
      resourceType,
      resourceId,
      expectedOrganizationId: organizationId,
      role,
      effectiveAt: now,
      expiresAt,
      registeredAt: now,
    });
    return 1;
  }
}

export class AgreementTemplateRegistry {
  constructor(
    readonly pool: Pool,
    readonly store: ImmutableEvidenceStore,
  ) {}
  async register(input: {
    kind: AgreementKind;
    version: string;
    resourceType: AgreementResourceType;
    role: AgreementRole;
    legalGateReceiptId: string;
    effectiveAt: string;
    expiresAt: string;
    registeredAt: string;
  }) {
    if (
      !input.version.trim() ||
      input.version.length > 100 ||
      Date.parse(input.effectiveAt) > Date.parse(input.registeredAt) ||
      Date.parse(input.expiresAt) <= Date.parse(input.registeredAt)
    )
      throw new Error("agreement template validity invalid");
    agreementApprovalBindingSha256({
      agreementId: "00000000-0000-4000-8000-000000000000",
      version: input.version,
      kind: input.kind,
      bodySha256: "0".repeat(64),
      resourceType: input.resourceType,
      resourceId: "00000000-0000-4000-8000-000000000001",
      expectedOrganizationId: "00000000-0000-4000-8000-000000000002",
      role: input.role,
      effectiveAt: input.effectiveAt,
      expiresAt: input.expiresAt,
    });
    const legal = (
      await this.pool.query(
        "select * from authority_receipts where receipt_id=$1 and authority_kind='LEGAL_AGREEMENT_TEMPLATE' and effective_at<=$2 and expires_at>$2 and retrieved_at<=$2",
        [input.legalGateReceiptId, input.registeredAt],
      )
    ).rows[0];
    if (!legal || Date.parse(input.expiresAt) > Date.parse(legal.expires_at))
      throw new Error("current agreement template receipt missing");
    const bytes = await this.store.readVerified(
        String(legal.body_object_key),
        String(legal.body_sha256),
      ),
      template = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      placeholderNames = [
        ...new Set(
          [...template.matchAll(/\{\{([a-z_]+)\}\}/g)].map(
            (value) => value[1]!,
          ),
        ),
      ].sort(),
      allowed = ALLOWED_PLACEHOLDERS[input.kind];
    if (!allowed || placeholderNames.some((name) => !allowed.includes(name)))
      throw new Error("agreement template placeholders invalid");
    const required = ["agreement_id", "role", "version"];
    if (required.some((name) => !placeholderNames.includes(name)))
      throw new Error("agreement template required placeholders missing");
    if (
      legal.proposition !==
      `AGREEMENT_TEMPLATE:${input.kind}:${input.version}:${legal.body_sha256}:RENDERER_V1`
    )
      throw new Error("agreement template legal approval mismatch");
    const prior = (
      await this.pool.query(
        "select id,template_sha256,legal_gate_receipt_id from agreement_templates where agreement_kind=$1 and version=$2 and role=$3",
        [input.kind, input.version, input.role],
      )
    ).rows[0];
    if (prior) {
      if (
        prior.template_sha256 !== legal.body_sha256 ||
        prior.legal_gate_receipt_id !== input.legalGateReceiptId
      )
        throw new Error("agreement template version conflict");
      return Object.freeze({
        id: String(prior.id),
        templateSha256: String(legal.body_sha256),
      });
    }
    const id = randomUUID();
    await this.pool.query(
      "insert into agreement_templates(id,agreement_kind,version,resource_type,role,template_object_key,template_sha256,placeholder_names,legal_gate_receipt_id,effective_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        id,
        input.kind,
        input.version,
        input.resourceType,
        input.role,
        legal.body_object_key,
        legal.body_sha256,
        placeholderNames,
        input.legalGateReceiptId,
        input.effectiveAt,
        input.expiresAt,
      ],
    );
    return Object.freeze({ id, templateSha256: String(legal.body_sha256) });
  }
}
