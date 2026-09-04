import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import jwt from "@fastify/jwt";
import rawBody from "fastify-raw-body";
import rateLimit from "@fastify/rate-limit";
import type Redis from "ioredis";
import type { Pool } from "pg";
import { assertAuthorized, type Principal, type Role } from "../security.js";
import type { ProductionActivationPayload } from "../runtime/activation.js";
import {
  ProductionCommandService,
  settlementInstructionAcceptanceDigest,
} from "../runtime/commands.js";
import type { SensitiveDataCipher } from "../runtime/sensitive_data.js";
import { createHash, randomUUID } from "node:crypto";
import {
  ProviderPartyAccountRegistry,
  type ProviderPartyRole,
} from "../runtime/provider_parties.js";
import type { ImmutableEvidenceStore } from "../runtime/object_store.js";
import type { DocumentIngestionPipeline } from "../connectors/documents.js";
import {
  AgreementRegistry,
  type AgreementResourceType,
  type AgreementRole,
} from "../runtime/agreement_registry.js";
import type { AgreementKind } from "../agreements.js";
import { AgreementTemplateRegistry } from "../runtime/agreement_automation.js";
import type { AuthorityUseGuard } from "../runtime/authority_receipts.js";
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      role: Role;
      organizationId: string | null;
      emailVerified?: boolean;
      amr?: string[];
      jti?: string;
      exp?: number;
    };
    user: {
      sub: string;
      role: Role;
      organizationId: string | null;
      emailVerified?: boolean;
      amr?: string[];
      jti?: string;
      exp?: number;
    };
  }
}
export interface ApiDependencies {
  readonly pool: Pool;
  readonly jwtPublicKey: string;
  readonly jwtIssuer: string;
  readonly jwtAudience: string;
  readonly jwtAlgorithm?: "RS256" | "EdDSA";
  readonly activation: Readonly<ProductionActivationPayload> | null;
  readonly releaseDigest: string;
  readonly activationGuard?: AuthorityUseGuard;
  readonly sensitiveDataCipher?: SensitiveDataCipher;
  readonly evidenceStore?: ImmutableEvidenceStore;
  readonly documentPipeline?: DocumentIngestionPipeline;
  readonly redis: Redis;
  readonly webhookHandlers: Readonly<
    Record<
      string,
      (
        raw: Uint8Array,
        headers: Readonly<Record<string, string | undefined>>,
      ) => Promise<string>
    >
  >;
}
function principal(request: FastifyRequest): Principal {
  return {
    principalId: request.user.sub,
    role: request.user.role,
    organizationId: request.user.organizationId,
    sessionExpiresAt: request.user.exp
      ? new Date(request.user.exp * 1000).toISOString()
      : new Date(0).toISOString(),
    disabled: false,
  };
}
export async function createProductionApi(
  deps: ApiDependencies,
): Promise<FastifyInstance> {
  const app = Fastify({
      logger: true,
      bodyLimit: 30_000_000,
      requestIdHeader: "x-request-id",
    }),
    commands = new ProductionCommandService(deps.pool),
    providerPartyRegistry = deps.sensitiveDataCipher
      ? new ProviderPartyAccountRegistry(deps.pool, deps.sensitiveDataCipher)
      : null,
    agreementRegistry = deps.evidenceStore
      ? new AgreementRegistry(deps.pool, deps.evidenceStore)
      : null,
    agreementTemplateRegistry = deps.evidenceStore
      ? new AgreementTemplateRegistry(deps.pool, deps.evidenceStore)
      : null;
  await app.register(jwt, {
    secret: { public: deps.jwtPublicKey },
    verify: {
      algorithms: [deps.jwtAlgorithm ?? "RS256"],
      allowedIss: deps.jwtIssuer,
      allowedAud: deps.jwtAudience,
    },
  });
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: false,
    runFirst: true,
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    redis: deps.redis,
    keyGenerator: (request) => request.ip,
  });
  app.addHook("preHandler", async (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method))
      await deps.activationGuard?.assertCurrent();
  });
  app.decorate("authenticate", async (request: FastifyRequest) => {
    await request.jwtVerify();
    if (
      !/^[0-9a-f-]{36}$/i.test(request.user.sub) ||
      !["OPERATIONS", "SUPPLIER", "BUYER", "SYSTEM"].includes(
        request.user.role,
      ) ||
      ((request.user.role === "SUPPLIER" || request.user.role === "BUYER") &&
        !request.user.organizationId)
    )
      throw new Error("JWT claims invalid");
    if (request.user.role === "SUPPLIER" || request.user.role === "BUYER") {
      const current = await deps.pool.query(
        "select p.state from counterparty_principals p join organizations o on o.id=p.organization_id where p.issuer_subject=$1 and p.organization_id=$2 and p.role=$3 and p.state in('INVITED','ACTIVE') and o.organization_type=$3",
        [request.user.sub, request.user.organizationId, request.user.role],
      );
      if (!current.rowCount) throw new Error("principal disabled or organization unavailable");
      if(current.rows[0]?.state==='INVITED'){
        if(request.user.emailVerified!==true||!(request.user.amr??[]).length)throw new Error("invited principal requires verified authentication");
        await deps.pool.query("update counterparty_principals set state='ACTIVE',activated_at=now() where issuer_subject=$1 and state='INVITED'",[request.user.sub]);
      }
    }
  });
  app.get("/healthz", async () => ({
    state: "OK",
    releaseDigest: deps.releaseDigest,
  }));
  app.get(
    "/v1/session",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const p = principal(request);
      assertAuthorized(
        p,
        {
          organizationId: p.organizationId,
          allowedRoles: ["OPERATIONS", "SYSTEM", "SUPPLIER", "BUYER"],
        },
        new Date().toISOString(),
      );
      return {
        principalId: p.principalId,
        role: p.role,
        organizationId: p.organizationId,
        emailVerified: request.user.emailVerified === true,
        expiresAt: p.sessionExpiresAt,
      };
    },
  );
  app.get("/readyz", async (_request, reply) => {
    try {
      await deps.pool.query("select 1");
      await deps.activationGuard?.assertCurrent();
      return {
        state: "READY",
        liveCapabilities: deps.activation?.capabilities ?? [],
      };
    } catch {
      return reply.code(503).send({ state: "UNAVAILABLE" });
    }
  });
  app.get(
    "/v1/readiness",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      assertAuthorized(
        principal(request),
        { organizationId: null, allowedRoles: ["OPERATIONS", "SYSTEM"] },
        new Date().toISOString(),
      );
      let activationCurrent = false;
      try {
        if (deps.activationGuard) {
          await deps.activationGuard.assertCurrent();
          activationCurrent = deps.activation !== null;
        }
      } catch {
        activationCurrent = false;
      }
      return {
        releaseDigest: deps.releaseDigest,
        activation: deps.activation && activationCurrent
          ? {
              state: "CURRENT",
              authorizedAt: deps.activation.authorizedAt,
              expiresAt: deps.activation.expiresAt,
              capabilities: deps.activation.capabilities,
            }
          : {
              state: deps.activation
                ? "EXPIRED_OR_REVOKED"
                : "BLOCKED_OPERATOR",
              capabilities: [],
            },
        constitutionalLimits: {
          inventory: "0",
          cargoCapital: "0",
          creditExposure: "0",
        },
      };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/v1/trades/:id",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const result = await deps.pool.query(
          "select t.id,t.supplier_id,t.buyer_id,t.state,t.relationship_id,t.updated_at,m.demand_id,m.demand_version from trades t left join matches m on m.id=t.match_id where t.id=$1",
          [request.params.id],
        ),
        row = result.rows[0];
      if (!row) return reply.code(404).send({ error: "NOT_FOUND" });
      const p = principal(request),
        organizationId =
          p.role === "SUPPLIER"
            ? row.supplier_id
            : p.role === "BUYER"
              ? row.buyer_id
              : null;
      assertAuthorized(
        p,
        { organizationId, allowedRoles: ["OPERATIONS", "SYSTEM", p.role] },
        new Date().toISOString(),
      );
      const released = [
        "IDENTITY_RELEASED",
        "CONTRACTED",
        "FUNDED",
        "DISPATCHED",
        "IN_TRANSIT",
        "DELIVERED",
        "ACCEPTED",
        "SETTLED",
        "RECURRING",
      ].includes(row.state);
      const instruction =
          (
            await deps.pool.query(
              "select * from settlement_instructions where trade_id=$1 order by created_at desc limit 1",
              [row.id],
            )
          ).rows[0] ?? null,
        contractAcceptances = (
          await deps.pool.query(
            "select role from trade_contract_acceptances where trade_id=$1 order by role",
            [row.id],
          )
        ).rows.map((value) => value.role),
        settlementAcceptances = instruction
          ? (
              await deps.pool.query(
                "select role from settlement_instruction_acceptances where instruction_id=$1 and instruction_digest=$2 order by role",
                [
                  instruction.id,
                  settlementInstructionAcceptanceDigest(instruction),
                ],
              )
            ).rows.map((value) => value.role)
          : [],
        carrierRows = p.role === "SUPPLIER" && ["FUNDED","DISPATCHED","IN_TRANSIT"].includes(row.state)
          ? (await deps.pool.query("select o.id,o.legal_name_ciphertext from organizations o join carrier_profiles c on c.organization_id=o.id and c.state='VERIFIED' and c.valid_until>now() join authority_receipts a on a.receipt_id=c.authority_receipt_id and a.authority_kind='CARRIER_PROVIDER_APPROVAL' and a.effective_at<=now() and a.expires_at>now() where o.organization_type='PROVIDER' order by o.created_at limit 100")).rows
          : [];
      return {
        id: row.id,
        viewerRole: p.role,
        state: row.state,
        relationshipId: row.relationship_id,
        supplierId:
          released || p.role === "SUPPLIER" || p.role === "OPERATIONS"
            ? row.supplier_id
            : "SEALED",
        buyerId:
          released || p.role === "BUYER" || p.role === "OPERATIONS"
            ? row.buyer_id
            : "SEALED",
        updatedAt: row.updated_at,
        settlement: instruction
          ? {
              id: instruction.id,
              provider: instruction.provider,
              currency: instruction.currency,
              gross_amount: instruction.gross_amount,
              supplier_entitlement: instruction.supplier_entitlement,
              sablestone_entitlement: instruction.sablestone_entitlement,
              expires_at: instruction.expires_at,
              acknowledged: instruction.acknowledged,
              instructionDigest:
                settlementInstructionAcceptanceDigest(instruction),
              acceptances: settlementAcceptances,
              fundingReference:
                p.role === "BUYER" && instruction.acknowledged
                  ? instruction.provider_reference
                  : null,
              fundingToken:
                p.role === "BUYER" && instruction.acknowledged && instruction.funding_token_ciphertext
                  ? (
                      await deps.pool.query(
                        "select pgp_sym_decrypt($1::bytea,$2) token",
                        [instruction.funding_token_ciphertext, process.env.SABLESTONE_DATA_KEY_BASE64 ?? ""],
                      )
                    ).rows[0]?.token ?? null
                  : null,
            }
          : null,
        contractAcceptances,
        demandId: row.demand_id ?? null,
        demandVersion: row.demand_version ?? null,
        carriers: carrierRows.map(carrier=>({
          id: carrier.id,
          name: deps.sensitiveDataCipher
            ? deps.sensitiveDataCipher.decrypt(carrier.legal_name_ciphertext)
            : `Carrier ${String(carrier.id).slice(0,8)}`,
        })),
        nextAction: tradeNextAction(
          row.state,
          instruction,
          contractAcceptances,
          p.role,
        ),
      };
    },
  );
  app.get("/v1/trades", { onRequest: [app.authenticate] }, async (request) => {
    const p = principal(request);
    assertAuthorized(
      p,
      {
        organizationId: p.organizationId,
        allowedRoles: ["OPERATIONS", "SYSTEM", "SUPPLIER", "BUYER"],
      },
      new Date().toISOString(),
    );
    const clause =
        p.role === "SUPPLIER"
          ? "where supplier_id=$1"
          : p.role === "BUYER"
            ? "where buyer_id=$1"
            : "",
      params = clause ? [p.organizationId] : [];
    return {
      items: (
        await deps.pool.query(
          `select id,state,relationship_id,updated_at from trades ${clause} order by updated_at desc limit 100`,
          params,
        )
      ).rows,
    };
  });
  app.get(
    "/v1/operations/summary",
    { onRequest: [app.authenticate] },
    async (request) => {
      const p = principal(request);
      assertAuthorized(
        p,
        { organizationId: null, allowedRoles: ["OPERATIONS", "SYSTEM"] },
        new Date().toISOString(),
      );
      const [offers, demands, trades, inbox, outbound, providers] =
        await Promise.all([
          deps.pool.query(
            "select count(*)::int count from supplier_offers where verification='VERIFIED' and freshness='CURRENT' and expires_at>now()",
          ),
          deps.pool.query(
            "select count(*)::int count from buyer_demands where verification='VERIFIED' and freshness='CURRENT' and expires_at>now()",
          ),
          deps.pool.query(
            "select state,count(*)::int count from trades group by state order by state",
          ),
          deps.pool.query(
            "select processing_state,count(*)::int count from external_event_inbox group by processing_state order by processing_state",
          ),
          deps.pool.query(
            "select state,count(*)::int count from outbound_email_jobs group by state order by state",
          ),
          deps.pool.query(
            "select distinct on(provider) provider,state,reason,evaluated_at from provider_capability_snapshots where environment='PRODUCTION' order by provider,evaluated_at desc",
          ),
        ]);
      return {
        offers: offers.rows[0]?.count ?? 0,
        demands: demands.rows[0]?.count ?? 0,
        trades: trades.rows,
        inbox: inbox.rows,
        outbound: outbound.rows,
        providers: providers.rows,
      };
    },
  );
  app.post<{
    Body:{fileName?:string;contentType?:string;dataBase64?:string;kind?:"SHIPMENT_DISPATCH"|"SHIPMENT_TRANSIT"|"SHIPMENT_DELIVERY"};
  }>("/v1/documents",{onRequest:[app.authenticate],config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async(request,reply)=>{
    const p=principal(request),body=request.body;
    if((p.role!=="SUPPLIER"&&p.role!=="BUYER")||!p.organizationId)return reply.code(403).send({error:"ROLE_FORBIDDEN"});
    if(!deps.documentPipeline||!deps.sensitiveDataCipher||!body?.fileName||!body.contentType||!body.dataBase64||!body.kind)return reply.code(400).send({error:"DOCUMENT_UPLOAD_UNAVAILABLE"});
    let bytes:Buffer;
    try{bytes=Buffer.from(body.dataBase64,"base64");if(!bytes.length||bytes.toString("base64")!==body.dataBase64.replace(/\s/g,""))throw new Error("invalid base64")}catch{return reply.code(400).send({error:"DOCUMENT_INVALID"})}
    try{
      const ingested=await deps.documentPipeline.ingest(body.fileName,bytes,body.contentType,`portal:${p.organizationId}:${body.kind}`),documentId=randomUUID();
      await deps.pool.query("insert into documents(id,organization_id,kind,object_key_ciphertext,sha256) values($1,$2,$3,$4,$5)",[documentId,p.organizationId,body.kind,deps.sensitiveDataCipher.encrypt(ingested.objectKey),ingested.sha256]);
      return reply.code(201).send({documentId,sha256:ingested.sha256,mediaType:ingested.mediaType});
    }catch{return reply.code(409).send({error:"DOCUMENT_REJECTED"})}
  });
  app.post<{
    Body: {
      kind?: AgreementKind;
      version?: string;
      resourceType?: AgreementResourceType;
      role?: AgreementRole;
      legalGateReceiptId?: string;
      effectiveAt?: string;
      expiresAt?: string;
    };
  }>(
    "/v1/system/agreement-templates",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const p = principal(request),
        body = request.body,
        now = new Date().toISOString();
      try {
        assertAuthorized(
          p,
          { organizationId: null, allowedRoles: ["SYSTEM"] },
          now,
        );
      } catch {
        return reply.code(403).send({ error: "ROLE_FORBIDDEN" });
      }
      if (
        !deps.activation?.capabilities.includes("TRADING") ||
        !agreementTemplateRegistry
      )
        return reply
          .code(503)
          .send({ error: "AGREEMENT_TEMPLATE_PROVISIONING_UNAVAILABLE" });
      if (
        !body?.kind ||
        !body.version ||
        !body.resourceType ||
        !body.role ||
        !body.legalGateReceiptId ||
        !body.effectiveAt ||
        !body.expiresAt ||
        Number.isNaN(Date.parse(body.effectiveAt)) ||
        Number.isNaN(Date.parse(body.expiresAt))
      )
        return reply.code(400).send({ error: "AGREEMENT_TEMPLATE_INVALID" });
      try {
        return reply.code(201).send(
          await agreementTemplateRegistry.register({
            kind: body.kind,
            version: body.version,
            resourceType: body.resourceType,
            role: body.role,
            legalGateReceiptId: body.legalGateReceiptId,
            effectiveAt: body.effectiveAt,
            expiresAt: body.expiresAt,
            registeredAt: now,
          }),
        );
      } catch {
        return reply.code(409).send({ error: "AGREEMENT_TEMPLATE_REJECTED" });
      }
    },
  );
  app.post<{
    Body: {
      agreementId?: string;
      version?: string;
      kind?: AgreementKind;
      legalGateReceiptId?: string;
      resourceType?: AgreementResourceType;
      resourceId?: string;
      expectedOrganizationId?: string;
      role?: AgreementRole;
      effectiveAt?: string;
      expiresAt?: string;
    };
  }>(
    "/v1/system/agreements",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const p = principal(request),
        body = request.body,
        now = new Date().toISOString();
      try {
        assertAuthorized(
          p,
          { organizationId: null, allowedRoles: ["SYSTEM"] },
          now,
        );
      } catch {
        return reply.code(403).send({ error: "ROLE_FORBIDDEN" });
      }
      if (
        !deps.activation?.capabilities.includes("TRADING") ||
        !agreementRegistry
      )
        return reply
          .code(503)
          .send({ error: "AGREEMENT_PROVISIONING_UNAVAILABLE" });
      if (
        !body?.agreementId ||
        !body.version ||
        !body.kind ||
        !body.legalGateReceiptId ||
        !body.resourceType ||
        !body.resourceId ||
        !body.expectedOrganizationId ||
        !body.role ||
        !body.effectiveAt ||
        !body.expiresAt ||
        !/^[0-9a-f-]{36}$/i.test(body.agreementId) ||
        !/^[0-9a-f-]{36}$/i.test(body.legalGateReceiptId) ||
        !/^[0-9a-f-]{36}$/i.test(body.resourceId) ||
        !/^[0-9a-f-]{36}$/i.test(body.expectedOrganizationId) ||
        Number.isNaN(Date.parse(body.effectiveAt)) ||
        Number.isNaN(Date.parse(body.expiresAt))
      )
        return reply
          .code(400)
          .send({ error: "AGREEMENT_REGISTRATION_INVALID" });
      try {
        return reply.code(201).send(
          await agreementRegistry.register({
            agreementId: body.agreementId,
            version: body.version,
            kind: body.kind,
            legalGateReceiptId: body.legalGateReceiptId,
            resourceType: body.resourceType,
            resourceId: body.resourceId,
            expectedOrganizationId: body.expectedOrganizationId,
            role: body.role,
            effectiveAt: body.effectiveAt,
            expiresAt: body.expiresAt,
            registeredAt: now,
          }),
        );
      } catch {
        return reply
          .code(409)
          .send({ error: "AGREEMENT_REGISTRATION_REJECTED" });
      }
    },
  );
  app.post<{
    Body: {
      provider?: string;
      organizationId?: string;
      role?: ProviderPartyRole;
      references?: Record<string, unknown>;
      verificationReceiptId?: string;
      validUntil?: string;
    };
  }>(
    "/v1/system/provider-party-accounts",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const p = principal(request),
        body = request.body,
        now = new Date().toISOString();
      try {
        assertAuthorized(
          p,
          { organizationId: null, allowedRoles: ["SYSTEM"] },
          now,
        );
      } catch {
        return reply.code(403).send({ error: "ROLE_FORBIDDEN" });
      }
      if (
        !deps.activation?.capabilities.includes("SETTLEMENT") ||
        !providerPartyRegistry
      )
        return reply
          .code(503)
          .send({ error: "SETTLEMENT_PROVISIONING_UNAVAILABLE" });
      if (
        !body?.provider ||
        !body.organizationId ||
        !body.role ||
        !body.references ||
        !body.verificationReceiptId ||
        !body.validUntil ||
        Number.isNaN(Date.parse(body.validUntil))
      )
        return reply
          .code(400)
          .send({ error: "PROVIDER_PARTY_ACCOUNT_INVALID" });
      try {
        return reply.code(201).send(
          await providerPartyRegistry.register({
            provider: body.provider,
            organizationId: body.organizationId,
            role: body.role,
            references: body.references,
            verificationReceiptId: body.verificationReceiptId,
            validUntil: body.validUntil,
            registeredAt: now,
          }),
        );
      } catch {
        return reply
          .code(409)
          .send({ error: "PROVIDER_PARTY_ACCOUNT_REJECTED" });
      }
    },
  );
  app.post<{
    Params: { id: string };
    Body: { authorityReceiptId?: string; reason?: string };
  }>(
    "/v1/system/provider-party-accounts/:id/revocations",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const p = principal(request),
        body = request.body,
        now = new Date().toISOString();
      try {
        assertAuthorized(
          p,
          { organizationId: null, allowedRoles: ["SYSTEM"] },
          now,
        );
      } catch {
        return reply.code(403).send({ error: "ROLE_FORBIDDEN" });
      }
      if (
        !deps.activation?.capabilities.includes("SETTLEMENT") ||
        !providerPartyRegistry
      )
        return reply
          .code(503)
          .send({ error: "SETTLEMENT_PROVISIONING_UNAVAILABLE" });
      if (
        !/^[0-9a-f-]{36}$/i.test(request.params.id) ||
        !body?.authorityReceiptId ||
        !body.reason
      )
        return reply
          .code(400)
          .send({ error: "PROVIDER_PARTY_REVOCATION_INVALID" });
      try {
        return reply.code(201).send({
          revocationId: await providerPartyRegistry.revoke({
            id: request.params.id,
            authorityReceiptId: body.authorityReceiptId,
            reason: body.reason,
            revokedAt: now,
          }),
        });
      } catch {
        return reply
          .code(409)
          .send({ error: "PROVIDER_PARTY_REVOCATION_REJECTED" });
      }
    },
  );
  app.get("/v1/offers", { onRequest: [app.authenticate] }, async (request) => {
    const p = principal(request);
    assertAuthorized(
      p,
      {
        organizationId: p.organizationId,
        allowedRoles: ["OPERATIONS", "SYSTEM", "SUPPLIER"],
      },
      new Date().toISOString(),
    );
    const params = p.role === "SUPPLIER" ? [p.organizationId] : [],
      where = p.role === "SUPPLIER" ? "where supplier_id=$1" : "";
    return {
      items: (
        await deps.pool.query(
          `select id,supplier_id,product_family,quantity_mt,moq_mt,supplier_net,currency,freshness from supplier_offers ${where} order by created_at desc limit 100`,
          params,
        )
      ).rows,
    };
  });
  app.get("/v1/demands", { onRequest: [app.authenticate] }, async (request) => {
    const p = principal(request);
    assertAuthorized(
      p,
      {
        organizationId: p.organizationId,
        allowedRoles: ["OPERATIONS", "SYSTEM", "BUYER"],
      },
      new Date().toISOString(),
    );
    const params = p.role === "BUYER" ? [p.organizationId] : [],
      where = p.role === "BUYER" ? "where buyer_id=$1" : "";
    return {
      items: (
        await deps.pool.query(
          `select id,buyer_id,product_family,quantity_mt,buyer_ceiling,currency,freshness from buyer_demands ${where} order by created_at desc limit 100`,
          params,
        )
      ).rows,
    };
  });
  app.get(
    "/v1/agreements",
    { onRequest: [app.authenticate] },
    async (request) => {
      const p = principal(request);
      if ((p.role !== "SUPPLIER" && p.role !== "BUYER") || !p.organizationId)
        return { items: [] };
      const kinds =
        p.role === "SUPPLIER"
          ? [
              "SUPPLIER_MASTER_BROKERAGE",
              "PROTECTED_ACCOUNT_NOTICE",
              "TRANSACTION_CONFIRMATION",
              "SETTLEMENT_INSTRUCTIONS",
            ]
          : [
              "BUYER_ACCESS_TERMS",
              "PROTECTED_SUPPLIER_ACKNOWLEDGEMENT",
              "TRANSACTION_CONFIRMATION",
              "SETTLEMENT_INSTRUCTIONS",
            ];
      return {
        items: (
          await deps.pool.query(
            "select a.id,a.agreement_kind,a.version,a.body_sha256,a.effective_at,a.expires_at,b.id agreement_binding_id,b.resource_type,b.resource_id,b.binding_sha256,exists(select 1 from agreement_acceptances accepted where accepted.agreement_binding_id=b.id and accepted.signer_organization_id=$1) accepted,case when a.agreement_kind in('PROTECTED_ACCOUNT_NOTICE','PROTECTED_SUPPLIER_ACKNOWLEDGEMENT') then exists(select 1 from protected_match_acceptances pma join agreement_acceptances aa on aa.id=pma.agreement_acceptance_id where aa.agreement_binding_id=b.id and pma.match_id=b.resource_id and pma.organization_id=$1) when a.agreement_kind='TRANSACTION_CONFIRMATION' then exists(select 1 from trade_contract_acceptances tca join agreement_acceptances aa on aa.id=tca.agreement_acceptance_id where aa.agreement_binding_id=b.id and tca.trade_id=b.resource_id and tca.organization_id=$1) else exists(select 1 from agreement_acceptances accepted where accepted.agreement_binding_id=b.id and accepted.signer_organization_id=$1) end action_completed from agreements a join agreement_resource_bindings b on b.agreement_id=a.id and b.agreement_version=a.version join authority_receipts legal on legal.receipt_id=b.legal_gate_receipt_id where b.expected_organization_id=$1 and b.role=$2 and legal.authority_kind in('LEGAL_AGREEMENT_APPROVAL','LEGAL_AGREEMENT_TEMPLATE') and legal.retrieved_at<=now() and legal.effective_at<=now() and legal.expires_at>now() and a.agreement_kind=any($3) and a.effective_at<=now() and a.expires_at>now() order by a.agreement_kind,a.version desc",
            [p.organizationId, p.role, kinds],
          )
        ).rows,
      };
    },
  );
  app.get<{
    Params: { id: string; version: string; bindingId: string };
  }>(
    "/v1/agreements/:id/:version/bindings/:bindingId/body",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const p = principal(request);
      if ((p.role !== "SUPPLIER" && p.role !== "BUYER") || !p.organizationId)
        return reply.code(403).send({ error: "ROLE_FORBIDDEN" });
      if (!deps.evidenceStore)
        return reply.code(503).send({ error: "AGREEMENT_BODY_UNAVAILABLE" });
      const row = (
        await deps.pool.query(
          "select a.body_object_key,a.body_sha256 from agreements a join agreement_resource_bindings b on b.agreement_id=a.id and b.agreement_version=a.version join authority_receipts legal on legal.receipt_id=b.legal_gate_receipt_id where a.id=$1 and a.version=$2 and b.id=$3 and b.expected_organization_id=$4 and b.role=$5 and legal.authority_kind in('LEGAL_AGREEMENT_APPROVAL','LEGAL_AGREEMENT_TEMPLATE') and legal.retrieved_at<=now() and legal.effective_at<=now() and legal.expires_at>now() and a.effective_at<=now() and a.expires_at>now()",
          [
            request.params.id,
            request.params.version,
            request.params.bindingId,
            p.organizationId,
            p.role,
          ],
        )
      ).rows[0];
      if (!row) return reply.code(404).send({ error: "AGREEMENT_NOT_FOUND" });
      try {
        const bytes = await deps.evidenceStore.readVerified(
          String(row.body_object_key),
          String(row.body_sha256),
        );
        return reply
          .header("content-type", "application/octet-stream")
          .header(
            "content-disposition",
            `inline; filename="sablestone-agreement-${request.params.id}-${request.params.version}.bin"`,
          )
          .header("cache-control", "private, no-store")
          .header("x-content-type-options", "nosniff")
          .header("x-sablestone-body-sha256", String(row.body_sha256))
          .send(Buffer.from(bytes));
      } catch {
        return reply
          .code(503)
          .send({ error: "AGREEMENT_BODY_VERIFICATION_FAILED" });
      }
    },
  );
  app.post<{
    Params:{id:string};Body:{reason?:string;evidenceReceiptId?:string|null};
  }>("/v1/trades/:id/disputes",{onRequest:[app.authenticate]},async(request,reply)=>{
    const p=principal(request);if(p.role!=="BUYER"||!p.organizationId)return reply.code(403).send({error:"ROLE_FORBIDDEN"});
    if(!request.body?.reason)return reply.code(400).send({error:"DISPUTE_REASON_REQUIRED"});
    try{return reply.code(201).send({disputeId:await commands.openDispute({tradeId:request.params.id,buyerId:p.organizationId,reason:request.body.reason,evidenceReceiptId:request.body.evidenceReceiptId??null,openedAt:new Date().toISOString()})});}catch{return reply.code(409).send({error:"DISPUTE_REJECTED"});}
  });
  app.get("/v1/actions",{onRequest:[app.authenticate]},async(request)=>{const p=principal(request);assertAuthorized(p,{organizationId:p.organizationId,allowedRoles:["OPERATIONS","SYSTEM","SUPPLIER","BUYER"]},new Date().toISOString());const clause=p.role==="OPERATIONS"||p.role==="SYSTEM"?"":"where a.organization_id=$1",params=clause?[p.organizationId]:[];return{items:(await deps.pool.query(`select a.id,a.action_type,a.resource_type,a.resource_id,case when a.resource_type='SETTLEMENT_INSTRUCTION' then si.trade_id else a.resource_id end destination_resource_id,a.actor_role,a.state,a.deadline,a.evidence_required from counterparty_actions a left join settlement_instructions si on a.resource_type='SETTLEMENT_INSTRUCTION' and si.id=a.resource_id ${clause} order by case a.state when 'REQUIRED' then 0 when 'NOTIFIED' then 1 else 2 end,a.deadline limit 200`,params)).rows};});
  app.post<{
    Params: { id: string; version: string };
    Body: { agreementBindingId?: string };
  }>(
    "/v1/agreements/:id/:version/acceptance",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const p = principal(request),
        user = request.user;
      if ((p.role !== "SUPPLIER" && p.role !== "BUYER") || !p.organizationId)
        return reply.code(403).send({ error: "ROLE_FORBIDDEN" });
      if (!deps.sensitiveDataCipher)
        return reply.code(503).send({ error: "E_SIGN_UNAVAILABLE" });
      const agreementBindingId = request.body?.agreementBindingId;
      if (
        !user.emailVerified ||
        !user.amr?.includes("otp") ||
        !user.jti ||
        !user.exp ||
        !agreementBindingId ||
        !/^[0-9a-f-]{36}$/i.test(agreementBindingId) ||
        !(await allowedAgreement(
          deps.pool,
          request.params.id,
          request.params.version,
          agreementBindingId,
          p.organizationId,
          p.role,
        ))
      )
        return reply.code(403).send({ error: "CURRENT_OTP_AUTH_REQUIRED" });
      try {
        const acceptedAt = new Date().toISOString(),
          result = await commands.acceptAgreement({
            agreementId: request.params.id,
            agreementVersion: request.params.version,
            agreementBindingId,
            organizationId: p.organizationId,
            userId: user.sub,
            authChallengeId: user.jti,
            authExpiresAt: new Date(user.exp * 1000).toISOString(),
            acceptedAt,
            ipAddressCiphertext: deps.sensitiveDataCipher.encrypt(request.ip),
            userAgentDigest: createHash("sha256")
              .update(request.headers["user-agent"] ?? "")
              .digest("hex"),
          });
        return reply.code(201).send(result);
      } catch {
        return reply.code(409).send({ error: "AGREEMENT_ACCEPTANCE_REJECTED" });
      }
    },
  );
  app.post<{
    Params: { id: string };
    Body: { agreementAcceptanceId?: string };
  }>(
    "/v1/matches/:id/protected-acceptance",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const p = principal(request);
      if ((p.role !== "SUPPLIER" && p.role !== "BUYER") || !p.organizationId)
        return reply.code(403).send({ error: "ROLE_FORBIDDEN" });
      const agreementAcceptanceId = request.body?.agreementAcceptanceId;
      if (
        !agreementAcceptanceId ||
        !/^[0-9a-f-]{36}$/i.test(agreementAcceptanceId)
      )
        return reply.code(400).send({ error: "AGREEMENT_ACCEPTANCE_REQUIRED" });
      try {
        const acceptanceDigest = await commands.acceptProtectedMatch({
          matchId: request.params.id,
          organizationId: p.organizationId,
          role: p.role,
          agreementAcceptanceId,
          acceptedAt: new Date().toISOString(),
        });
        return reply.code(202).send({ state: "ACCEPTED", acceptanceDigest });
      } catch (error) {
        return reply.code(409).send({
          error: "ACCEPTANCE_REJECTED",
          reason: (error as Error).message,
        });
      }
    },
  );
  app.post<{ Params: { id: string }; Body: { instructionDigest?: string } }>(
    "/v1/settlement-instructions/:id/acceptance",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const p = principal(request);
      if ((p.role !== "SUPPLIER" && p.role !== "BUYER") || !p.organizationId)
        return reply.code(403).send({ error: "ROLE_FORBIDDEN" });
      const instructionDigest = request.body?.instructionDigest;
      if (!instructionDigest || !/^[0-9a-f]{64}$/.test(instructionDigest))
        return reply.code(400).send({ error: "INSTRUCTION_DIGEST_REQUIRED" });
      try {
        const canonical = await commands.acceptSettlementInstruction({
          instructionId: request.params.id,
          organizationId: p.organizationId,
          role: p.role,
          instructionDigest,
          acceptedAt: new Date().toISOString(),
        });
        return reply
          .code(202)
          .send({ state: "ACCEPTED", instructionDigest: canonical });
      } catch (error) {
        return reply.code(409).send({
          error: "ACCEPTANCE_REJECTED",
          reason: (error as Error).message,
        });
      }
    },
  );
  app.post<{
    Params: { id: string };
    Body: { agreementAcceptanceId?: string };
  }>(
    "/v1/trades/:id/contract-acceptance",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const p = principal(request);
      if ((p.role !== "SUPPLIER" && p.role !== "BUYER") || !p.organizationId)
        return reply.code(403).send({ error: "ROLE_FORBIDDEN" });
      const acceptance = request.body?.agreementAcceptanceId;
      if (!acceptance || !/^[0-9a-f-]{36}$/i.test(acceptance))
        return reply.code(400).send({ error: "AGREEMENT_ACCEPTANCE_REQUIRED" });
      try {
        const state = await commands.acceptTradeContract({
          tradeId: request.params.id,
          organizationId: p.organizationId,
          role: p.role,
          agreementAcceptanceId: acceptance,
          acceptedAt: new Date().toISOString(),
        });
        return reply.code(202).send({ state });
      } catch {
        return reply.code(409).send({ error: "CONTRACT_ACCEPTANCE_REJECTED" });
      }
    },
  );
  app.post<{
    Params: { id: string };
    Body: {
      carrierOrganizationId?: string;
      responsiblePartyId?: string;
      eventType?: "DISPATCHED" | "IN_TRANSIT" | "DELIVERED";
      documentReceiptId?: string;
      occurredAt?: string;
    };
  }>(
    "/v1/trades/:id/shipment-events",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const p = principal(request),
        body = request.body;
      if ((p.role !== "SUPPLIER" && p.role !== "BUYER") || !p.organizationId)
        return reply.code(403).send({ error: "ROLE_FORBIDDEN" });
      if (
        !body?.carrierOrganizationId ||
        !body.responsiblePartyId ||
        !body.eventType ||
        !body.documentReceiptId ||
        !body.occurredAt ||
        Number.isNaN(Date.parse(body.occurredAt))
      )
        return reply.code(400).send({ error: "SHIPMENT_EVENT_INVALID" });
      try {
        return reply.code(201).send({
          eventId: await commands.recordShipment({
            tradeId: request.params.id,
            organizationId: p.organizationId,
            carrierOrganizationId: body.carrierOrganizationId,
            responsiblePartyId: body.responsiblePartyId,
            eventType: body.eventType,
            documentReceiptId: body.documentReceiptId,
            occurredAt: body.occurredAt,
          }),
        });
      } catch {
        return reply.code(409).send({ error: "SHIPMENT_EVENT_REJECTED" });
      }
    },
  );
  app.post<{
    Params: { id: string };
    Body: {
      acceptanceKind?: "ACCEPTED" | "INSPECTION_PASS" | "COA_WAIVER";
      evidenceReceiptId?: string | null;
    };
  }>(
    "/v1/trades/:id/delivery-acceptance",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const p = principal(request),
        kind = request.body?.acceptanceKind;
      if (p.role !== "BUYER" || !p.organizationId)
        return reply.code(403).send({ error: "ROLE_FORBIDDEN" });
      if (!kind)
        return reply.code(400).send({ error: "ACCEPTANCE_KIND_REQUIRED" });
      try {
        return reply.code(201).send({
          acceptanceId: await commands.acceptDelivery({
            tradeId: request.params.id,
            buyerId: p.organizationId,
            acceptanceKind: kind,
            evidenceReceiptId: request.body?.evidenceReceiptId ?? null,
            acceptedAt: new Date().toISOString(),
          }),
        });
      } catch {
        return reply.code(409).send({ error: "DELIVERY_ACCEPTANCE_REJECTED" });
      }
    },
  );
  app.post<{
    Params: { id: string; version: string };
    Body: { maximumRenewals?: number; validUntil?: string; cadenceDays?: number; nextRequiredAt?: string; quantityToleranceMt?: string; maximumAllInPricePerKg?: string; currency?: string; supplierScope?: "SAME_SUPPLIER"|"APPROVED_SUBSTITUTION" };
  }>(
    "/v1/demands/:id/:version/standing-authorization",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const p = principal(request),
        maximumRenewals = request.body?.maximumRenewals,
        validUntil = request.body?.validUntil,
        cadenceDays=request.body?.cadenceDays,
        nextRequiredAt=request.body?.nextRequiredAt,
        quantityToleranceMt=request.body?.quantityToleranceMt,
        maximumAllInPricePerKg=request.body?.maximumAllInPricePerKg,
        currency=request.body?.currency,
        supplierScope=request.body?.supplierScope;
      if (p.role !== "BUYER" || !p.organizationId)
        return reply.code(403).send({ error: "ROLE_FORBIDDEN" });
      if (
        !maximumRenewals ||
        !validUntil ||
        Number.isNaN(Date.parse(validUntil)) || !cadenceDays || !nextRequiredAt || Number.isNaN(Date.parse(nextRequiredAt)) || quantityToleranceMt===undefined || !maximumAllInPricePerKg || !currency || !supplierScope
      )
        return reply
          .code(400)
          .send({ error: "STANDING_AUTHORIZATION_INVALID" });
      try {
        return reply.code(201).send({
          acceptanceDigest: await commands.authorizeStandingDemand({
            demandId: request.params.id,
            version: Number(request.params.version),
            buyerId: p.organizationId,
            maximumRenewals,
            validUntil,
            confirmedAt: new Date().toISOString(),
            cadenceDays,
            nextRequiredAt,
            quantityToleranceMt,
            maximumAllInPricePerKg,
            currency,
            supplierScope,
          }),
        });
      } catch {
        return reply
          .code(409)
          .send({ error: "STANDING_AUTHORIZATION_REJECTED" });
      }
    },
  );
  for (const [provider, handler] of Object.entries(deps.webhookHandlers))
    app.post(
      `/webhooks/${provider}`,
      {
        config: {
          rawBody: true,
          rateLimit: { max: 120, timeWindow: "1 minute" },
        },
      },
      async (request, reply) => {
        const rawValue = (request as FastifyRequest & { rawBody?: Buffer })
            .rawBody,
          raw = rawValue ? new Uint8Array(rawValue) : new Uint8Array(),
          headers = Object.fromEntries(
            Object.entries(request.headers).map(([key, value]) => [
              key,
              Array.isArray(value) ? value[0] : value,
            ]),
          );
        try {
          if (raw.length === 0) throw new Error("raw webhook body missing");
          const eventId = await handler(raw, headers);
          return reply.code(202).send({ accepted: true, eventId });
        } catch {
          return reply.code(401).send({ accepted: false });
        }
      },
    );
  return app;
}
async function allowedAgreement(
  pool: Pool,
  id: string,
  version: string,
  bindingId: string,
  organizationId: string,
  role: "SUPPLIER" | "BUYER",
): Promise<boolean> {
  const kinds =
    role === "SUPPLIER"
      ? [
          "SUPPLIER_MASTER_BROKERAGE",
          "PROTECTED_ACCOUNT_NOTICE",
          "TRANSACTION_CONFIRMATION",
          "SETTLEMENT_INSTRUCTIONS",
        ]
      : [
          "BUYER_ACCESS_TERMS",
          "PROTECTED_SUPPLIER_ACKNOWLEDGEMENT",
          "TRANSACTION_CONFIRMATION",
          "SETTLEMENT_INSTRUCTIONS",
        ];
  return Boolean(
    (
      await pool.query(
        "select 1 from agreements a join agreement_resource_bindings b on b.agreement_id=a.id and b.agreement_version=a.version join authority_receipts legal on legal.receipt_id=b.legal_gate_receipt_id where a.id=$1 and a.version=$2 and b.id=$3 and b.expected_organization_id=$4 and b.role=$5 and legal.authority_kind in('LEGAL_AGREEMENT_APPROVAL','LEGAL_AGREEMENT_TEMPLATE') and legal.retrieved_at<=now() and legal.effective_at<=now() and legal.expires_at>now() and a.agreement_kind=any($6) and a.effective_at<=now() and a.expires_at>now()",
        [id, version, bindingId, organizationId, role, kinds],
      )
    ).rowCount,
  );
}
function tradeNextAction(
  state: string,
  instruction: unknown,
  contractAcceptances: string[],
  role: Role,
): string {
  if (state === "PROTECTED")
    return instruction
      ? "ACCEPT_SETTLEMENT_INSTRUCTION"
      : "WAIT_FOR_SETTLEMENT_INSTRUCTION";
  if (state === "FEE_LOCKED") return "WAIT_FOR_IDENTITY_RELEASE";
  if (state === "IDENTITY_RELEASED")
    return contractAcceptances.includes(role)
      ? "WAIT_FOR_COUNTERPARTY_CONTRACT_ACCEPTANCE"
      : "ACCEPT_TRANSACTION_CONFIRMATION";
  if (state === "CONTRACTED") return "WAIT_FOR_BUYER_FUNDING";
  if (["FUNDED", "DISPATCHED", "IN_TRANSIT"].includes(state))
    return "TRACK_SUPPLIER_OWNED_SHIPMENT";
  if (state === "DELIVERED")
    return role === "BUYER"
      ? "ACCEPT_OR_DISPUTE_DELIVERY"
      : "WAIT_FOR_BUYER_ACCEPTANCE";
  if (state === "ACCEPTED") return "WAIT_FOR_INDEPENDENT_SETTLEMENT";
  if (state === "SETTLED") return "CREATE_STANDING_REQUIREMENT";
  return "NO_ACTION_AVAILABLE";
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}
