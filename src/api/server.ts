import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import jwt from "@fastify/jwt";
import rawBody from "fastify-raw-body";
import rateLimit from "@fastify/rate-limit";
import type Redis from "ioredis";
import type { Pool } from "pg";
import { assertAuthorized, type Principal, type Role } from "../security.js";
import type { ProductionActivationPayload } from "../runtime/activation.js";
import { ProductionCommandService } from "../runtime/commands.js";
import type { SensitiveDataCipher } from "../runtime/sensitive_data.js";
import { createHash } from "node:crypto";
import {
  ProviderPartyAccountRegistry,
  type ProviderPartyRole,
} from "../runtime/provider_parties.js";
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
  readonly activation: Readonly<ProductionActivationPayload> | null;
  readonly releaseDigest: string;
  readonly sensitiveDataCipher?: SensitiveDataCipher;
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
      : null;
  await app.register(jwt, {
    secret: { public: deps.jwtPublicKey },
    verify: {
      algorithms: ["EdDSA", "RS256"],
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
  });
  app.get("/healthz", async () => ({
    state: "OK",
    releaseDigest: deps.releaseDigest,
  }));
  app.get("/readyz", async (_request, reply) => {
    try {
      await deps.pool.query("select 1");
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
      return {
        releaseDigest: deps.releaseDigest,
        activation: deps.activation
          ? {
              authorizedAt: deps.activation.authorizedAt,
              expiresAt: deps.activation.expiresAt,
              capabilities: deps.activation.capabilities,
            }
          : { state: "BLOCKED_OPERATOR" },
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
          "select id,supplier_id,buyer_id,state,relationship_id,updated_at from trades where id=$1",
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
              "select id,provider,currency,gross_amount,supplier_entitlement,sablestone_entitlement,expires_at,acknowledged from settlement_instructions where trade_id=$1 order by created_at desc limit 1",
              [row.id],
            )
          ).rows[0] ?? null,
        contractAcceptances = (
          await deps.pool.query(
            "select role from trade_contract_acceptances where trade_id=$1 order by role",
            [row.id],
          )
        ).rows.map((value) => value.role);
      return {
        id: row.id,
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
        settlement: instruction,
        contractAcceptances,
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
            "select id,agreement_kind,version,body_sha256,effective_at,expires_at from agreements where agreement_kind=any($1) and effective_at<=now() and expires_at>now() order by agreement_kind,version desc",
            [kinds],
          )
        ).rows,
      };
    },
  );
  app.post<{ Params: { id: string; version: string } }>(
    "/v1/agreements/:id/:version/acceptance",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const p = principal(request),
        user = request.user;
      if ((p.role !== "SUPPLIER" && p.role !== "BUYER") || !p.organizationId)
        return reply.code(403).send({ error: "ROLE_FORBIDDEN" });
      if (!deps.sensitiveDataCipher)
        return reply.code(503).send({ error: "E_SIGN_UNAVAILABLE" });
      if (
        !user.emailVerified ||
        !user.amr?.includes("otp") ||
        !user.jti ||
        !user.exp ||
        !(await allowedAgreement(
          deps.pool,
          request.params.id,
          request.params.version,
          p.role,
        ))
      )
        return reply.code(403).send({ error: "CURRENT_OTP_AUTH_REQUIRED" });
      try {
        const acceptedAt = new Date().toISOString(),
          result = await commands.acceptAgreement({
            agreementId: request.params.id,
            agreementVersion: request.params.version,
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
    Body: { maximumRenewals?: number; validUntil?: string };
  }>(
    "/v1/demands/:id/:version/standing-authorization",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const p = principal(request),
        maximumRenewals = request.body?.maximumRenewals,
        validUntil = request.body?.validUntil;
      if (p.role !== "BUYER" || !p.organizationId)
        return reply.code(403).send({ error: "ROLE_FORBIDDEN" });
      if (
        !maximumRenewals ||
        !validUntil ||
        Number.isNaN(Date.parse(validUntil))
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
        "select 1 from agreements where id=$1 and version=$2 and agreement_kind=any($3) and effective_at<=now() and expires_at>now()",
        [id, version, kinds],
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
