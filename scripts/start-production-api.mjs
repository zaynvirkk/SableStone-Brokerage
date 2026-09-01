import { readFile } from "node:fs/promises";
import { OAuth2Client } from "google-auth-library";
import {
  bootstrapProduction,
  buildProductionSettlementAdapters,
  createGmailPushHandler,
  createProductionApi,
  createSettlementWebhookHandler,
  createBankWebhookHandler,
  DurableInboxRepository,
  GmailProductionConnector,
  PostgresHistoryCursorRepository,
  SensitiveDataCipher,
  assertCurrentAuthorityReceipt,
  assertCurrentCredentialBinding,
  DatabaseCredentialUseGuard,
  DatabaseAuthorityUseGuard,
} from "../dist/index.js";

const runtime = await bootstrapProduction(process.env);
const jwtPath = process.env.SABLESTONE_JWT_PUBLIC_KEY_PATH;
if (!jwtPath) throw new Error("JWT public key path required");
const jwtPublicKey = await readFile(jwtPath, "utf8");
const jwtIssuer = process.env.SABLESTONE_JWT_ISSUER,
  jwtAudience = process.env.SABLESTONE_JWT_AUDIENCE;
if (!jwtIssuer || !jwtAudience)
  throw new Error("JWT issuer and audience required");
const sensitiveDataCipher = runtime.activation.capabilities.some((capability) =>
  ["OUTREACH", "TRADING", "SETTLEMENT"].includes(capability),
)
  ? new SensitiveDataCipher(
      process.env.SABLESTONE_DATA_KEY_BASE64 ?? "",
      process.env.SABLESTONE_LOOKUP_HMAC_SECRET ?? "",
    )
  : undefined;
const inbox = new DurableInboxRepository(runtime.pool);
const webhookHandlers = {};

if (runtime.activation.capabilities.includes("SETTLEMENT")) {
  const adapters = await buildProductionSettlementAdapters(
    runtime.pool,
    runtime.evidence,
    process.env.SABLESTONE_SETTLEMENT_PROVIDERS_JSON,
  );
  for (const adapter of adapters) {
    const route = adapter.provider.toLowerCase().replaceAll("_", "-");
    const signatureHeader = adapter.config.webhookSignatureHeader;
    const eventIdPath = adapter.config.webhookEventIdPath;
    if (!signatureHeader || !eventIdPath)
      throw new Error(`webhook configuration incomplete: ${adapter.provider}`);
    webhookHandlers[route] = createSettlementWebhookHandler({
      adapter,
      store: runtime.evidence,
      inbox,
      signatureHeader,
      eventIdPath,
    });
  }
  const bankConfigs = JSON.parse(
    process.env.SABLESTONE_BANK_WEBHOOKS_JSON ?? "[]",
  );
  if (!Array.isArray(bankConfigs))
    throw new Error("bank webhook configuration invalid");
  for (const config of bankConfigs) {
    await assertCurrentAuthorityReceipt(
      runtime.pool,
      config.approvalReceiptId,
      "BANK_WEBHOOK_PROVIDER_APPROVAL",
    );
    const credentialInput = {
      provider: config.provider,
      capability: "BANK_WEBHOOK",
      environment: "PRODUCTION",
      credentialParts: [config.webhookSecret],
    };
    await assertCurrentCredentialBinding(runtime.pool, credentialInput);
    webhookHandlers[
      `bank-${config.provider.toLowerCase().replaceAll("_", "-")}`
    ] = createBankWebhookHandler({
      config,
      store: runtime.evidence,
      inbox,
      credentialGuard: new DatabaseCredentialUseGuard(
        runtime.pool,
        credentialInput,
      ),
      authorityGuard: new DatabaseAuthorityUseGuard(
        runtime.pool,
        config.approvalReceiptId,
        "BANK_WEBHOOK_PROVIDER_APPROVAL",
      ),
    });
  }
}

if (runtime.activation.capabilities.includes("OUTREACH")) {
  const gmailConfig = {
    userId: process.env.SABLESTONE_GMAIL_USER_ID ?? "",
    clientId: process.env.SABLESTONE_GMAIL_CLIENT_ID ?? "",
    clientSecret: process.env.SABLESTONE_GMAIL_CLIENT_SECRET ?? "",
    refreshToken: process.env.SABLESTONE_GMAIL_REFRESH_TOKEN ?? "",
    pubsubTopic: process.env.SABLESTONE_GMAIL_PUBSUB_TOPIC ?? "",
    pushAudience: process.env.SABLESTONE_GMAIL_PUSH_AUDIENCE ?? "",
    authorized: true,
  };
  const gmailCredentialInput = {
    provider: "GMAIL",
    capability: "GMAIL_OAUTH",
    environment: "PRODUCTION",
    credentialParts: [
      gmailConfig.userId,
      gmailConfig.clientId,
      gmailConfig.clientSecret,
      gmailConfig.refreshToken,
      gmailConfig.pubsubTopic,
      gmailConfig.pushAudience,
    ],
  };
  await assertCurrentCredentialBinding(runtime.pool, gmailCredentialInput);
  const gmail = new GmailProductionConnector(
    gmailConfig,
    runtime.evidence,
    undefined,
    new DatabaseCredentialUseGuard(runtime.pool, gmailCredentialInput),
    runtime.activationGuard,
  );
  webhookHandlers.gmail = createGmailPushHandler({
    connector: gmail,
    store: runtime.evidence,
    inbox,
    cursors: new PostgresHistoryCursorRepository(runtime.pool),
    oidc: new OAuth2Client(),
    audience: gmailConfig.pushAudience,
  });
}

const app = await createProductionApi({
  pool: runtime.pool,
  jwtPublicKey,
  jwtIssuer,
  jwtAudience,
  activation: runtime.activation,
  releaseDigest: runtime.releaseDigest,
  activationGuard: runtime.activationGuard,
  sensitiveDataCipher,
  evidenceStore: runtime.evidence,
  redis: runtime.redis,
  webhookHandlers,
});
const port = Number(process.env.PORT ?? "8080");
const shutdown = async () => {
  await app.close();
  await runtime.pool.end();
  runtime.redis.disconnect();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await app.listen({ host: "0.0.0.0", port });
