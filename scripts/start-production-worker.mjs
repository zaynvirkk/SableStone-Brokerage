import {
  bootstrapProduction,
  buildDatabaseStageHandlers,
  buildProductionInboxHandlers,
  buildProductionDocumentPipeline,
  buildProductionSettlementAdapters,
  createWorkflowClient,
  GmailProductionConnector,
  GmailWatchManager,
  DocumentJobDispatcher,
  DocumentVerificationJobDispatcher,
  QualificationJobDispatcher,
  buildProductionDocumentVerifier,
  buildHunterConnector,
  EnrichmentJobDispatcher,
  createBankInboxProcessor,
  buildProductionKyb,
  KybJobDispatcher,
  OutboundGmailDispatcher,
  CommercialNotificationDispatcher,
  ProductionDiscoveryService,
  ProductionActivityService,
  ProductionWorkflowScheduler,
  runBrokerageWorker,
  RuntimeSupervisor,
  SensitiveDataCipher,
  buildEconomicQuoteConnectors,
  EconomicQuoteJobDispatcher,
  EconomicEvaluationDispatcher,
  AcquisitionOutreachDispatcher,
  buildCommercialExtractor,
  AgreementAutomationDispatcher,
  bindBrokerageActivities,
  assertCurrentAuthorityReceipt,
} from "../dist/index.js";

const runtime = await bootstrapProduction(process.env);
if (
  !runtime.activation.capabilities.some((capability) =>
    ["DISCOVERY", "OUTREACH", "SETTLEMENT", "TRADING"].includes(capability),
  )
)
  throw new Error("operational activation required for worker");
const temporalConfig = {
  address: process.env.SABLESTONE_TEMPORAL_ADDRESS ?? "",
  namespace: process.env.SABLESTONE_TEMPORAL_NAMESPACE ?? "default",
  taskQueue:
    process.env.SABLESTONE_TEMPORAL_TASK_QUEUE ?? "sablestone-production",
  tls: process.env.SABLESTONE_TEMPORAL_TLS !== "false",
};
if (!temporalConfig.address) throw new Error("Temporal address required");

const adapters = runtime.activation.capabilities.includes("SETTLEMENT")
  ? await buildProductionSettlementAdapters(
      runtime.pool,
      runtime.evidence,
      process.env.SABLESTONE_SETTLEMENT_PROVIDERS_JSON,
    )
  : [];
let gmail = null,
  cipher = runtime.activation.capabilities.some((capability) =>
    ["DISCOVERY", "OUTREACH", "TRADING"].includes(capability),
  )
    ? new SensitiveDataCipher(
        process.env.SABLESTONE_DATA_KEY_BASE64 ?? "",
        process.env.SABLESTONE_LOOKUP_HMAC_SECRET ?? "",
      )
    : null,
  outbound = null,
  commercialNotifications = null,
  acquisitionOutreach = null,
  watch = null;
if (runtime.activation.capabilities.includes("OUTREACH")) {
  const gmailConfig = {
    userId: process.env.SABLESTONE_GMAIL_USER_ID ?? "",
    clientId: process.env.SABLESTONE_GMAIL_CLIENT_ID ?? "",
    clientSecret: process.env.SABLESTONE_GMAIL_CLIENT_SECRET ?? "",
    refreshToken: process.env.SABLESTONE_GMAIL_REFRESH_TOKEN ?? "",
    pubsubTopic: process.env.SABLESTONE_GMAIL_PUBSUB_TOPIC ?? "",
    pushAudience: process.env.SABLESTONE_GMAIL_PUSH_AUDIENCE ?? "",
    authorized: process.env.SABLESTONE_GMAIL_AUTHORIZED === "true",
  };
  gmail = new GmailProductionConnector(gmailConfig, runtime.evidence);
  outbound = new OutboundGmailDispatcher(
    runtime.pool,
    runtime.evidence,
    cipher,
    gmail,
  );
  commercialNotifications = new CommercialNotificationDispatcher(
    runtime.pool,
    runtime.evidence,
    cipher,
    gmail,
  );
  acquisitionOutreach = new AcquisitionOutreachDispatcher(
    runtime.pool,
    runtime.evidence,
    cipher,
    gmailConfig.userId,
  );
  watch = new GmailWatchManager(runtime.pool, gmail);
}
const documentPipeline = runtime.activation.capabilities.includes("OUTREACH")
    ? await buildProductionDocumentPipeline(
        runtime.pool,
        runtime.evidence,
        process.env.SABLESTONE_DOCUMENT_EXTRACTOR_JSON,
        process.env.SABLESTONE_CLAMAV_HOST,
        process.env.SABLESTONE_CLAMAV_PORT,
      )
    : null,
  documents =
    documentPipeline && cipher
      ? new DocumentJobDispatcher(
          runtime.pool,
          runtime.evidence,
          cipher,
          documentPipeline,
        )
      : null;
const documentVerifier = runtime.activation.capabilities.includes("TRADING")
    ? await buildProductionDocumentVerifier(
        runtime.pool,
        runtime.evidence,
        process.env.SABLESTONE_DOCUMENT_VERIFIER_JSON,
      )
    : null,
  documentVerification = documentVerifier
    ? new DocumentVerificationJobDispatcher(
        runtime.pool,
        runtime.evidence,
        documentVerifier,
      )
    : null,
  qualification = runtime.activation.capabilities.includes("TRADING")
    ? new QualificationJobDispatcher(runtime.pool)
    : null;
const hunter = runtime.activation.capabilities.includes("OUTREACH")
    ? await buildHunterConnector(
        runtime.pool,
        runtime.evidence,
        process.env.SABLESTONE_ENRICHMENT_JSON,
      )
    : null,
  enrichment =
    hunter && cipher
      ? new EnrichmentJobDispatcher(runtime.pool, cipher, hunter)
      : null;
const kybRuntime = runtime.activation.capabilities.includes("DISCOVERY")
    ? await buildProductionKyb(
        runtime.pool,
        runtime.evidence,
        process.env.SABLESTONE_KYB_JSON,
      )
    : null,
  kybJobs = kybRuntime ? new KybJobDispatcher(runtime.pool, kybRuntime) : null;
const economicConnectors = runtime.activation.capabilities.includes("TRADING")
    ? await buildEconomicQuoteConnectors(
        runtime.pool,
        runtime.evidence,
        process.env.SABLESTONE_ECONOMIC_QUOTE_PROVIDERS_JSON,
      )
    : [],
  economicJobs = economicConnectors.length
    ? new EconomicQuoteJobDispatcher(runtime.pool, economicConnectors)
    : null,
  economicEvaluation = runtime.activation.capabilities.includes("TRADING")
    ? new EconomicEvaluationDispatcher(runtime.pool)
    : null;
const commercialExtractor = runtime.activation.capabilities.includes("OUTREACH")
  ? await buildCommercialExtractor(
      runtime.pool,
      runtime.evidence,
      process.env.SABLESTONE_COMMERCIAL_EXTRACTOR_JSON,
    )
  : null;
const agreementAutomation = runtime.activation.capabilities.includes("TRADING")
  ? new AgreementAutomationDispatcher(runtime.pool, runtime.evidence)
  : null;
const { ProviderPartyReferenceResolver } =
  await import("../dist/runtime/provider_parties.js");
const providerParties = cipher
  ? new ProviderPartyReferenceResolver(runtime.pool, cipher)
  : null;

const controller = new AbortController(),
  client = await createWorkflowClient(temporalConfig),
  discovery =
    runtime.activation.capabilities.includes("DISCOVERY") && cipher
      ? new ProductionDiscoveryService(runtime.pool, runtime.evidence, cipher)
      : undefined,
  activityService = new ProductionActivityService(
    runtime.pool,
    buildDatabaseStageHandlers(
      runtime.pool,
      adapters,
      discovery,
      providerParties ?? undefined,
    ),
  ),
  activities = bindBrokerageActivities(activityService),
  handlers = {
    ...buildProductionInboxHandlers({
      pool: runtime.pool,
      store: runtime.evidence,
      cipher,
      gmail,
      settlementAdapters: adapters,
      commercialExtractor,
      providerParties,
    }),
  },
  supervisor = new RuntimeSupervisor(
    runtime.pool,
    client,
    temporalConfig.taskQueue,
    handlers,
  ),
  scheduler = discovery
    ? new ProductionWorkflowScheduler(
        runtime.pool,
        client,
        temporalConfig.taskQueue,
      )
    : null;
if (runtime.activation.capabilities.includes("SETTLEMENT")) {
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
    handlers[`BANK:${config.provider}`] = createBankInboxProcessor({
      pool: runtime.pool,
      store: runtime.evidence,
      config,
    });
  }
}

const periodic = async () => {
  while (!controller.signal.aborted) {
    try {
      if (watch) await watch.renewIfDue();
      if (outbound) await outbound.dispatchBatch();
      if (commercialNotifications)
        await commercialNotifications.dispatchBatch();
      if (acquisitionOutreach) await acquisitionOutreach.dispatchBatch();
      if (documents) await documents.dispatchBatch();
      if (documentVerification) await documentVerification.dispatchBatch();
      if (qualification) await qualification.dispatchBatch();
      if (enrichment) await enrichment.dispatchBatch();
      if (kybJobs) await kybJobs.dispatchBatch();
      if (economicJobs) await economicJobs.dispatchBatch();
      if (economicEvaluation) await economicEvaluation.dispatchBatch();
      if (agreementAutomation) await agreementAutomation.dispatchBatch();
      if (scheduler) await scheduler.tick();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "PERIODIC_CONNECTOR_FAILURE",
          errorCode: error?.name ?? "Error",
        }),
      );
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 60_000);
      controller.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
};
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());
try {
  await Promise.all([
    runBrokerageWorker(temporalConfig, activities, controller.signal),
    supervisor.run(controller.signal),
    periodic(),
  ]);
} finally {
  await runtime.pool.end();
  runtime.redis.disconnect();
}
