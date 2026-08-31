import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { GmailProductionConnector } from "../connectors/gmail.js";
import type { ProductionSettlementHttpAdapter } from "../connectors/settlement_http.js";
import type { EvidenceBoundCommercialExtractor } from "../connectors/commercial_extraction.js";
import {
  classifyInboundMime,
  createReplyMime,
  parseCommercialIntent,
} from "../connectors/communication_brain.js";
import type { EmailEvent, OutboundEmail } from "../email.js";
import type { ImmutableEvidenceStore } from "./object_store.js";
import { inTransaction, TransactionalOutboxRepository } from "./database.js";
import { SensitiveDataCipher } from "./sensitive_data.js";
import {
  negotiate,
  type NegotiationIntent,
  type NegotiationPolicy,
  type NegotiationSession,
} from "../negotiation.js";
import { decimal } from "../money.js";
import { compareDecimalStrings } from "../domain.js";
import { settlementInstructionAcceptanceDigest } from "./commands.js";

function path(value: unknown, dotted: string | undefined): unknown {
  return dotted
    ?.split(".")
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value,
    );
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} missing`);
  return value;
}

export function buildProductionInboxHandlers(input: {
  pool: Pool;
  store: ImmutableEvidenceStore;
  cipher: SensitiveDataCipher | null;
  gmail: GmailProductionConnector | null;
  settlementAdapters: readonly ProductionSettlementHttpAdapter[];
  commercialExtractor?: EvidenceBoundCommercialExtractor | null;
}): Readonly<Record<string, (event: QueryResultRow) => Promise<void>>> {
  const handlers: Record<string, (event: QueryResultRow) => Promise<void>> = {};
  if (input.gmail) {
    if (!input.cipher) throw new Error("Gmail sensitive-data cipher missing");
    handlers.GMAIL = (event) =>
      processGmailEvent(
        input.pool,
        input.store,
        input.cipher!,
        input.gmail!,
        event,
        input.commercialExtractor ?? null,
      );
  }
  for (const adapter of input.settlementAdapters)
    handlers[adapter.provider] = (event) =>
      processSettlementEvent(input.pool, input.store, adapter, event);
  return Object.freeze(handlers);
}

async function processGmailEvent(
  pool: Pool,
  store: ImmutableEvidenceStore,
  cipher: SensitiveDataCipher,
  gmail: GmailProductionConnector,
  event: QueryResultRow,
  extractor: EvidenceBoundCommercialExtractor | null,
): Promise<void> {
  const envelopeBytes = await store.readVerified(
      String(event.payload_object_key),
      String(event.payload_digest),
    ),
    envelope = JSON.parse(
      new TextDecoder().decode(envelopeBytes),
    ) as EmailEvent;
  if (
    envelope.externalEventId !== event.external_event_id ||
    !envelope.payloadObjectKey ||
    !/^[0-9a-f]{64}$/.test(envelope.payloadSha256)
  )
    throw new Error("Gmail inbox envelope invalid");
  const raw = await store.readVerified(
      envelope.payloadObjectKey,
      envelope.payloadSha256,
    ),
    deterministicDecision = await classifyInboundMime(raw),
    decision =
      extractor &&
      !deterministicDecision.offer &&
      !deterministicDecision.demand &&
      deterministicDecision.state !== "DECLINE"
        ? await extractor
            .extract(raw, envelope.occurredAt)
            .catch(() => deterministicDecision)
        : deterministicDecision,
    decisionDigest = createHash("sha256")
      .update(JSON.stringify(decision))
      .digest("hex"),
    communicationId = randomUUID(),
    jobId = randomUUID(),
    idempotencyKey = `reply:${envelope.externalEventId}:${decisionDigest}`,
    messageId = `<${createHash("sha256").update(idempotencyKey).digest("hex")}@mail.sablestone.internal>`,
    reply = createReplyMime({
      from: gmail.config.userId,
      to: envelope.sender,
      subject: "Re: SableStone material requirement",
      inReplyTo: envelope.messageId,
      messageId,
      body: decision.replyBody,
    }),
    replyReceipt = await store.preserve(
      "email/outbound",
      reply,
      "message/rfc822",
      idempotencyKey,
      envelope.occurredAt,
    ),
    sender = cipher.encrypt(envelope.sender),
    recipient = cipher.encrypt(envelope.recipient),
    replyRecipient = cipher.encrypt(envelope.sender),
    lookup = cipher.lookup(envelope.sender);
  await inTransaction(pool, async (client) => {
    const prior = await client.query(
      "select id from communications where external_event_id=$1",
      [envelope.externalEventId],
    );
    if (prior.rows[0]) return;
    await client.query(
      "insert into communications(id,external_event_id,event_type,thread_id,message_id,sender_ciphertext,recipient_ciphertext,occurred_at,payload_object_key) values($1,$2,'MESSAGE_RECEIVED',$3,$4,$5,$6,$7,$8)",
      [
        communicationId,
        envelope.externalEventId,
        envelope.threadId,
        envelope.messageId,
        sender,
        recipient,
        envelope.occurredAt,
        envelope.payloadObjectKey,
      ],
    );
    await client.query(
      "insert into inbound_message_decisions(id,communication_id,classification,decision_state,decision_digest,decision) values($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        communicationId,
        decision.classification,
        decision.state,
        decisionDigest,
        decision,
      ],
    );
    const contact = (
      await client.query(
        "select c.id,c.organization_id,o.organization_type from contacts c join organizations o on o.id=c.organization_id where c.email_lookup_hash=$1 and c.verification='VERIFIED' and not exists(select 1 from global_suppressions s where s.email_lookup_hash=c.email_lookup_hash) order by c.verified_at desc limit 1",
        [lookup],
      )
    ).rows[0];
    if (contact) {
      await client.query(
        "insert into communication_organizations(communication_id,organization_id,contact_id) values($1,$2,$3) on conflict(communication_id) do nothing",
        [communicationId, contact.organization_id, contact.id],
      );
      if (decision.demand && contact.organization_type === "BUYER") {
        const family = materialFamily(decision.demand.material);
        if (family)
          await client.query(
            "insert into buyer_demands(id,version,buyer_id,source_event_id,product_family,product_spec,quantity_mt,buyer_ceiling,ceiling_state,currency,standing,expires_at,verification,freshness) values($1,1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10,'DRAFT','CURRENT')",
            [
              randomUUID(),
              contact.organization_id,
              communicationId,
              family,
              {
                destination: decision.demand.destination,
                mfiMin: decision.demand.mfiMin,
                mfiMax: decision.demand.mfiMax,
              },
              decision.demand.quantityMt,
              decision.demand.ceilingPerKg,
              decision.demand.ceilingPerKg ? "KNOWN" : "UNKNOWN",
              decision.demand.currency,
              new Date(
                Date.parse(envelope.occurredAt) + 30 * 86400_000,
              ).toISOString(),
            ],
          );
      }
      if (decision.offer && contact.organization_type === "SUPPLIER") {
        const family = materialFamily(decision.offer.material);
        if (family)
          await client.query(
            "insert into supplier_offers(id,version,supplier_id,source_event_id,product_family,product_spec,quantity_mt,moq_mt,supplier_net,currency,expires_at,verification,freshness) values($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DRAFT','CURRENT')",
            [
              randomUUID(),
              contact.organization_id,
              communicationId,
              family,
              { mfiMin: decision.offer.mfiMin, mfiMax: decision.offer.mfiMax },
              decision.offer.quantityMt,
              decision.offer.moqMt,
              decision.offer.netPerKg,
              decision.offer.currency,
              new Date(
                Date.parse(envelope.occurredAt) + 7 * 86400_000,
              ).toISOString(),
            ],
          );
      }
      if (
        decision.classification === "COUNTEROFFER" &&
        decision.supplierText &&
        contact.organization_type === "BUYER"
      )
        await applyNegotiationIntent(
          client,
          contact.organization_id,
          decision.supplierText,
          envelope.occurredAt,
        );
    }
    if (decision.classification === "DOCUMENT")
      await client.query(
        "insert into document_processing_jobs(id,communication_id,raw_mime_object_key,raw_mime_sha256,source_message_id,state) values($1,$2,$3,$4,$5,'PENDING')",
        [
          randomUUID(),
          communicationId,
          envelope.payloadObjectKey,
          envelope.payloadSha256,
          envelope.messageId,
        ],
      );
    const suppressed = (
      await client.query(
        "select 1 from global_suppressions where email_lookup_hash=$1",
        [lookup],
      )
    ).rowCount;
    await client.query(
      "insert into outbound_email_jobs(id,idempotency_key,source_communication_id,thread_id,recipient_ciphertext,recipient_lookup_hash,subject,message_id,mime_object_key,mime_sha256,state) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        jobId,
        idempotencyKey,
        communicationId,
        envelope.threadId,
        replyRecipient,
        lookup,
        "Re: SableStone material requirement",
        messageId,
        replyReceipt.objectKey,
        replyReceipt.sha256,
        suppressed ? "SUPPRESSED" : "PENDING",
      ],
    );
  });
}
async function applyNegotiationIntent(
  client: PoolClient,
  buyerId: string,
  text: string,
  occurredAt: string,
): Promise<void> {
  const parsed = parseCommercialIntent(text);
  if (!parsed) throw new Error("commercial intent incomplete");
  const row = (
    await client.query(
      "select n.*,m.offer_id,m.demand_id,ef.amount_per_kg,pp.commission_floor_per_kg,np.maximum_concession_per_kg,np.version negotiation_policy_version,np.valid_until policy_valid_until from negotiations n join matches m on m.id=n.match_id join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version join economic_floors ef on ef.match_id=m.id and ef.state='KNOWN' join pricing_decisions pd on pd.match_id=m.id and pd.state='EXECUTABLE' join pricing_policies pp on pp.id=pd.policy_id and pp.version=pd.policy_version join negotiation_policies np on np.currency=n.currency and np.valid_from<=$2 and np.valid_until>$2 join authority_receipts ar on ar.receipt_id=np.authority_receipt_id and ar.effective_at<=$2 and ar.expires_at>$2 where d.buyer_id=$1 and n.status='OPEN' and n.expires_at>$2 order by n.expires_at limit 1 for update",
      [buyerId, occurredAt],
    )
  ).rows[0];
  if (!row) throw new Error("open buyer negotiation unavailable");
  const session: NegotiationSession = {
      sessionId: row.id,
      revision: row.revision,
      offerId: row.offer_id,
      offerVersion: row.offer_version,
      demandId: row.demand_id,
      demandVersion: row.demand_version,
      policyVersion: row.negotiation_policy_version,
      currentQuotePerKg: decimal(String(row.current_quote_per_kg)),
      currency: row.currency,
      expiresAt: new Date(row.expires_at).toISOString(),
      status: row.status,
    },
    policy: NegotiationPolicy = {
      policyVersion: row.negotiation_policy_version,
      currency: row.currency,
      economicFloorPerKg: decimal(String(row.amount_per_kg)),
      minimumCommissionPerKg: decimal(String(row.commission_floor_per_kg)),
      maximumConcessionPerKg: decimal(String(row.maximum_concession_per_kg)),
      expiresAt: new Date(row.policy_valid_until).toISOString(),
    },
    intent: NegotiationIntent =
      parsed.type === "ACCEPT"
        ? { type: "ACCEPT", sessionRevision: row.revision }
        : {
            type: "COUNTER_PRICE",
            pricePerKg: parsed.pricePerKg,
            currency: parsed.currency,
            sessionRevision: row.revision,
          },
    decision = negotiate(session, intent, policy, occurredAt),
    digest = createHash("sha256")
      .update(JSON.stringify({ intent, buyerId, occurredAt }))
      .digest("hex");
  await client.query(
    "insert into negotiation_decisions(id,negotiation_id,session_revision,intent_digest,action,executable_price_per_kg,reason,policy_version,decided_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(negotiation_id,session_revision,intent_digest) do nothing",
    [
      randomUUID(),
      row.id,
      row.revision,
      digest,
      decision.action,
      decision.executablePricePerKg,
      decision.reason,
      row.negotiation_policy_version,
      occurredAt,
    ],
  );
  await client.query(
    "update negotiations set revision=$2,current_quote_per_kg=coalesce($3,current_quote_per_kg),status=$4 where id=$1 and revision=$5",
    [
      row.id,
      decision.nextRevision,
      decision.executablePricePerKg,
      decision.action === "ACCEPT"
        ? "ACCEPTED"
        : decision.action === "DECLINE"
          ? "DECLINED"
          : decision.action === "EXPIRE"
            ? "EXPIRED"
            : "OPEN",
      row.revision,
    ],
  );
}
export function materialFamily(material: string): string | null {
  const value = material.toLowerCase();
  if (/recycled|\br(?:pp|hdpe|lldpe|ldpe)\b/.test(value)) {
    if (/hdpe/.test(value))
      return /black|colou?red/.test(value)
        ? "RHDPE_COLOURED_BLACK_BLOW_INJECTION"
        : "RHDPE_NATURAL_BLOW_INJECTION";
    if (/lldpe|ldpe/.test(value)) return "RLLDPE_LDPE_FILM";
    if (/pp/.test(value))
      return /black|colou?red/.test(value)
        ? "RPP_COLOURED_BLACK_INJECTION"
        : "RPP_NATURAL_LIGHT_INJECTION";
  }
  if (/hdpe/.test(value)) return "HDPE_PRIME_NON_PRIME";
  if (/lldpe/.test(value)) return "LLDPE_PRIME_NON_PRIME";
  if (/\bpp\b|polypropylene/.test(value)) return "PP_PRIME_NON_PRIME";
  return null;
}

async function processSettlementEvent(
  pool: Pool,
  store: ImmutableEvidenceStore,
  adapter: ProductionSettlementHttpAdapter,
  event: QueryResultRow,
): Promise<void> {
  const config = adapter.config;
  if (
    !config.webhookEventTypePath ||
    !config.webhookProviderReferencePath ||
    !config.webhookOccurredAtPath ||
    !config.webhookEventTypeMap
  )
    throw new Error("settlement projection configuration incomplete");
  const raw = await store.readVerified(
      String(event.payload_object_key),
      String(event.payload_digest),
    ),
    decoded = JSON.parse(new TextDecoder().decode(raw)),
    externalType = text(
      path(decoded, config.webhookEventTypePath),
      "provider event type",
    ),
    mappedType = config.webhookEventTypeMap[externalType],
    providerReference = text(
      path(decoded, config.webhookProviderReferencePath),
      "provider reference",
    ),
    occurredAt = text(
      path(decoded, config.webhookOccurredAtPath),
      "provider occurred_at",
    );
  if (!mappedType || Number.isNaN(Date.parse(occurredAt)))
    throw new Error("unsupported settlement event");
  const instruction = (
    await pool.query(
      "select i.*,t.relationship_id,t.state trade_state from settlement_instructions i join trades t on t.id=i.trade_id where i.provider=$1 and i.provider_reference=$2 and i.acknowledged",
      [adapter.provider, providerReference],
    )
  ).rows[0];
  if (!instruction) throw new Error("settlement event instruction unknown");
  const rawAmount = config.webhookAmountPath
      ? path(decoded, config.webhookAmountPath)
      : null,
    amount =
      rawAmount === null || rawAmount === undefined ? null : String(rawAmount),
    rawCurrency = config.webhookCurrencyPath
      ? path(decoded, config.webhookCurrencyPath)
      : null,
    currency =
      rawCurrency === null || rawCurrency === undefined
        ? null
        : String(rawCurrency).toUpperCase(),
    rawBank = config.webhookBankReferencePath
      ? path(decoded, config.webhookBankReferencePath)
      : null,
    bankReference =
      rawBank === null || rawBank === undefined ? null : String(rawBank);
  if (
    ["FUNDED", "ENTITLEMENT_SECURED"].includes(mappedType) &&
    (!amount ||
      compareDecimalStrings(
        decimal(amount),
        decimal(String(instruction.gross_amount)),
      ) !== 0 ||
      currency !== instruction.currency)
  )
    throw new Error("funding amount or currency mismatch");
  if (
    mappedType === "DISBURSEMENT_REPORTED" &&
    (!bankReference ||
      !amount ||
      compareDecimalStrings(
        decimal(amount),
        decimal(String(instruction.sablestone_entitlement)),
      ) !== 0 ||
      currency !== instruction.currency)
  )
    throw new Error("brokerage disbursement evidence mismatch");
  let internalType = mappedType,
    securityEvidenceSha256 = String(event.payload_digest),
    platformAllocationVerified = false;
  if (adapter.provider === "CASHFREE_EASY_SPLIT" && mappedType === "FUNDED") {
    const split = await adapter.applyCashfreeCapturedSplit(
      {
        instructionId: instruction.id,
        tradeId: instruction.trade_id,
        provider: instruction.provider,
        environment: "PRODUCTION",
        commodityFamily: instruction.commodity_family,
        buyerId: instruction.buyer_id,
        supplierId: instruction.supplier_id,
        sablestoneBeneficiaryId: instruction.sablestone_beneficiary_id,
        currency: instruction.currency,
        grossAmount: decimal(String(instruction.gross_amount)),
        supplierEntitlement: decimal(String(instruction.supplier_entitlement)),
        sablestoneEntitlement: decimal(
          String(instruction.sablestone_entitlement),
        ),
        otherAllocations: [],
        releaseConditions: instruction.release_conditions,
        disputeProcedure: instruction.dispute_procedure,
        expiresAt: new Date(instruction.expires_at).toISOString(),
        idempotencyKey: instruction.idempotency_key,
      },
      occurredAt,
    );
    securityEvidenceSha256 = createHash("sha256")
      .update(String(event.payload_digest))
      .update(split.receiptSha256)
      .digest("hex");
    platformAllocationVerified = true;
    internalType = "ENTITLEMENT_SECURED";
  }
  if (adapter.provider === "RAZORPAY_ROUTE" && mappedType === "FUNDED") {
    if (!config.webhookPaymentReferencePath)
      throw new Error("Razorpay captured payment reference path missing");
    const paymentReference = text(
        path(decoded, config.webhookPaymentReferencePath),
        "Razorpay payment reference",
      ),
      transfer = await adapter.applyRazorpayCapturedTransfer(
        {
          instructionId: instruction.id,
          tradeId: instruction.trade_id,
          provider: instruction.provider,
          environment: "PRODUCTION",
          commodityFamily: instruction.commodity_family,
          buyerId: instruction.buyer_id,
          supplierId: instruction.supplier_id,
          sablestoneBeneficiaryId: instruction.sablestone_beneficiary_id,
          currency: instruction.currency,
          grossAmount: decimal(String(instruction.gross_amount)),
          supplierEntitlement: decimal(
            String(instruction.supplier_entitlement),
          ),
          sablestoneEntitlement: decimal(
            String(instruction.sablestone_entitlement),
          ),
          otherAllocations: [],
          releaseConditions: instruction.release_conditions,
          disputeProcedure: instruction.dispute_procedure,
          expiresAt: new Date(instruction.expires_at).toISOString(),
          idempotencyKey: instruction.idempotency_key,
        },
        paymentReference,
        occurredAt,
      );
    securityEvidenceSha256 = createHash("sha256")
      .update(String(event.payload_digest))
      .update(transfer.receiptSha256)
      .digest("hex");
    platformAllocationVerified = true;
    internalType = "ENTITLEMENT_SECURED";
  }
  await inTransaction(pool, async (client) => {
    const inserted = await client.query(
      "insert into settlement_provider_events(id,provider,external_event_id,provider_reference,trade_id,event_type,amount,currency,occurred_at,payload_sha256,payload_object_key,bank_reference) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict(provider,external_event_id) do nothing returning id",
      [
        randomUUID(),
        adapter.provider,
        event.external_event_id,
        providerReference,
        instruction.trade_id,
        internalType,
        amount,
        currency,
        occurredAt,
        event.payload_digest,
        event.payload_object_key,
        bankReference,
      ],
    );
    if (!inserted.rows[0]) return;
    const outbox = new TransactionalOutboxRepository(pool);
    if (internalType === "ENTITLEMENT_SECURED") {
      if (
        !platformAllocationVerified &&
        (!config.webhookSablestoneBeneficiaryPath ||
          !config.webhookSupplierBeneficiaryPath ||
          String(path(decoded, config.webhookSablestoneBeneficiaryPath)) !==
            String(instruction.sablestone_beneficiary_id) ||
          String(path(decoded, config.webhookSupplierBeneficiaryPath)) !==
            String(instruction.supplier_id))
      )
        throw new Error("settlement beneficiary evidence mismatch");
      const acceptances = (
          await client.query(
            "select role,instruction_digest from settlement_instruction_acceptances where instruction_id=$1",
            [instruction.id],
          )
        ).rows,
        digest = settlementInstructionAcceptanceDigest(instruction);
      if (
        acceptances.length !== 2 ||
        acceptances.some((row) => row.instruction_digest !== digest) ||
        !instruction.provider_approval_id
      )
        throw new Error("secured entitlement lacks exact accepted instruction");
      const securityId = randomUUID(),
        feeLockId = randomUUID();
      await client.query(
        "insert into entitlement_security_events(id,instruction_id,settlement_provider_event_id,provider,provider_reference,gross_amount,supplier_entitlement,sablestone_entitlement,currency,beneficiary_verified,funds_secured,evidence_sha256,secured_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,true,true,$10,$11)",
        [
          securityId,
          instruction.id,
          inserted.rows[0].id,
          adapter.provider,
          providerReference,
          instruction.gross_amount,
          instruction.supplier_entitlement,
          instruction.sablestone_entitlement,
          instruction.currency,
          securityEvidenceSha256,
          occurredAt,
        ],
      );
      await client.query(
        "insert into fee_locks(id,trade_id,relationship_id,instruction_id,provider,provider_approval_id,provider_reference,instruction_digest,supplier_accepted_instruction_digest,buyer_accepted_instruction_digest,supplier_entitlement,sablestone_entitlement,gross_amount,currency,state,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$8,$8,$9,$10,$11,$12,'LOCKED',$13)",
        [
          feeLockId,
          instruction.trade_id,
          instruction.relationship_id,
          instruction.id,
          adapter.provider,
          instruction.provider_approval_id,
          providerReference,
          digest,
          instruction.supplier_entitlement,
          instruction.sablestone_entitlement,
          instruction.gross_amount,
          instruction.currency,
          occurredAt,
        ],
      );
      await client.query(
        "update settlement_instructions set entitlement_secured_at=$2,entitlement_security_event_id=$3 where id=$1 and entitlement_secured_at is null",
        [instruction.id, occurredAt, securityId],
      );
      const updated = await client.query(
        "update trades set state='FEE_LOCKED',updated_at=now() where id=$1 and state='PROTECTED'",
        [instruction.trade_id],
      );
      if ((updated.rowCount ?? 0) !== 1)
        throw new Error("secured entitlement trade-state conflict");
      await outbox.append(client, {
        id: randomUUID(),
        aggregateType: "TRADE",
        aggregateId: instruction.trade_id,
        eventType: "ENTITLEMENT_SECURED",
        payload: { tradeId: instruction.trade_id, feeLockId, securityId },
        idempotencyKey: `trade:${instruction.trade_id}:entitlement-secured`,
      });
    } else if (
      internalType === "FUNDED" &&
      instruction.trade_state === "CONTRACTED"
    ) {
      const updated = await client.query(
        "update trades set state='FUNDED',updated_at=now() where id=$1 and state='CONTRACTED'",
        [instruction.trade_id],
      );
      if ((updated.rowCount ?? 0) !== 1)
        throw new Error("funding transition conflict");
      await outbox.append(client, {
        id: randomUUID(),
        aggregateType: "TRADE",
        aggregateId: instruction.trade_id,
        eventType: "TRADE_FUNDED",
        payload: {
          provider: adapter.provider,
          externalEventId: event.external_event_id,
        },
        idempotencyKey: `trade:${instruction.trade_id}:funded`,
      });
    } else if (
      ["FAILED", "REVERSED"].includes(internalType) &&
      !["SETTLED", "RECURRING"].includes(instruction.trade_state)
    ) {
      await client.query(
        "update trades set state='SETTLEMENT_FAILED',updated_at=now() where id=$1 and state not in('SETTLED','RECURRING','SETTLEMENT_FAILED')",
        [instruction.trade_id],
      );
    } else if (
      internalType === "DISPUTE_OPENED" &&
      !["SETTLED", "RECURRING"].includes(instruction.trade_state)
    ) {
      await client.query(
        "update trades set state='DISPUTED_FROZEN',updated_at=now() where id=$1 and state not in('SETTLED','RECURRING','DISPUTED_FROZEN')",
        [instruction.trade_id],
      );
    }
  });
}

export class OutboundGmailDispatcher {
  constructor(
    readonly pool: Pool,
    readonly store: ImmutableEvidenceStore,
    readonly cipher: SensitiveDataCipher,
    readonly gmail: GmailProductionConnector,
  ) {}
  async dispatchBatch(limit = 20): Promise<number> {
    if (limit < 1 || limit > 50)
      throw new Error("outbound batch limit invalid");
    const rows = await inTransaction(
      this.pool,
      async (client) =>
        (
          await client.query(
            "with claimed as(select id from outbound_email_jobs where state='PENDING' or(state='PROCESSING' and claimed_at<now()-interval '10 minutes') order by created_at for update skip locked limit $1) update outbound_email_jobs j set state='PROCESSING',claimed_at=now(),attempts=attempts+1 from claimed where j.id=claimed.id returning j.*",
            [limit],
          )
        ).rows,
    );
    let sent = 0;
    for (const row of rows) {
      try {
        if (
          (
            await this.pool.query(
              "select 1 from global_suppressions where email_lookup_hash=$1",
              [row.recipient_lookup_hash],
            )
          ).rowCount
        ) {
          await this.pool.query(
            "update outbound_email_jobs set state='SUPPRESSED',claimed_at=null where id=$1 and state='PROCESSING'",
            [row.id],
          );
          continue;
        }
        const body = await this.store.readVerified(
            row.mime_object_key,
            row.mime_sha256,
          ),
          message: OutboundEmail = {
            idempotencyKey: row.idempotency_key,
            threadId: row.thread_id,
            recipient: this.cipher.decrypt(row.recipient_ciphertext),
            subject: row.subject,
            bodyObjectKey: row.mime_object_key,
            messageId: row.message_id,
          },
          result = await this.gmail.send(message, body);
        await this.pool.query(
          "update outbound_email_jobs set state='SENT',provider_message_id=$2,provider_thread_id=$3,sent_at=now(),claimed_at=null where id=$1 and state='PROCESSING'",
          [row.id, result.messageId, result.threadId],
        );
        sent++;
      } catch (error) {
        await this.pool.query(
          "update outbound_email_jobs set state=case when attempts>=5 then 'FAILED' else 'PENDING' end,claimed_at=null,last_error_code=$2 where id=$1 and state='PROCESSING'",
          [row.id, (error as Error).name.slice(0, 100)],
        );
      }
    }
    return sent;
  }
}

export class CommercialNotificationDispatcher {
  constructor(
    readonly pool: Pool,
    readonly store: ImmutableEvidenceStore,
    readonly cipher: SensitiveDataCipher,
    readonly gmail: GmailProductionConnector,
  ) {}
  async dispatchBatch(limit = 20): Promise<number> {
    const jobs = await inTransaction(
      this.pool,
      async (client) =>
        (
          await client.query(
            "with claimed as(select id from commercial_notification_jobs where state='PENDING' or(state='PROCESSING' and claimed_at<now()-interval '10 minutes') order by created_at for update skip locked limit $1) update commercial_notification_jobs j set state='PROCESSING',attempts=attempts+1,claimed_at=now() from claimed where j.id=claimed.id returning j.*",
            [limit],
          )
        ).rows,
    );
    let completed = 0;
    for (const job of jobs) {
      try {
        const facts = (
          await this.pool.query(
            "select n.current_quote_per_kg,n.currency,n.expires_at,o.supplier_id,o.product_family,o.product_spec,o.quantity_mt,o.moq_mt,d.buyer_id,d.product_spec demand_spec,d.quantity_mt demand_quantity from negotiations n join matches m on m.id=n.match_id join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version where n.id=$1 and n.status='OPEN'",
            [job.negotiation_id],
          )
        ).rows[0];
        if (!facts) throw new Error("open negotiation unavailable");
        const organizationId =
            job.recipient_role === "SUPPLIER"
              ? facts.supplier_id
              : facts.buyer_id,
          contact = (
            await this.pool.query(
              "select id,email_ciphertext,email_lookup_hash from contacts c where c.organization_id=$1 and c.verification='VERIFIED' and not exists(select 1 from global_suppressions s where s.email_lookup_hash=c.email_lookup_hash) order by c.verified_at desc limit 1",
              [organizationId],
            )
          ).rows[0];
        if (!contact) {
          await this.pool.query(
            "update commercial_notification_jobs set state='SUPPRESSED',completed_at=now(),claimed_at=null,last_error_code='VERIFIED_CONTACT_UNAVAILABLE' where id=$1",
            [job.id],
          );
          continue;
        }
        const recipient = this.cipher.decrypt(contact.email_ciphertext),
          threadId = `negotiation-${job.negotiation_id}`,
          messageId = `<${createHash("sha256").update(`commercial:${job.id}`).digest("hex")}@mail.sablestone.internal>`,
          counterparty =
            job.recipient_role === "SUPPLIER"
              ? {
                  account: "ANONYMOUS_BUYER",
                  quantityMt: facts.demand_quantity,
                  spec: facts.demand_spec,
                }
              : {
                  account: "ANONYMOUS_SUPPLIER",
                  quantityMt: facts.quantity_mt,
                  moqMt: facts.moq_mt,
                  spec: facts.product_spec,
                },
          body = [
            "SableStone protected opportunity",
            "",
            `Material: ${facts.product_family}`,
            `Executable price: ${facts.currency} ${facts.current_quote_per_kg}/kg`,
            `Allocation expires: ${new Date(facts.expires_at).toISOString()}`,
            `Counterparty: ${counterparty.account}`,
            `Quantity: ${counterparty.quantityMt} MT`,
            ...("moqMt" in counterparty
              ? [`MOQ: ${counterparty.moqMt} MT`]
              : []),
            `Specification: ${JSON.stringify(counterparty.spec)}`,
            "",
            "Identity remains sealed. Accept only through the authenticated protected-account workflow.",
          ].join("\n"),
          mime = createReplyMime({
            from: this.gmail.config.userId,
            to: recipient,
            subject: `Protected ${facts.product_family} opportunity`,
            inReplyTo: `<${threadId}@mail.sablestone.internal>`,
            messageId,
            body,
          }),
          stored = await this.store.preserve(
            "email/outbound",
            mime,
            "message/rfc822",
            `commercial:${job.id}`,
          ),
          communicationId = randomUUID();
        await inTransaction(this.pool, async (client) => {
          await client.query(
            "insert into communications(id,external_event_id,event_type,thread_id,message_id,sender_ciphertext,recipient_ciphertext,occurred_at,payload_object_key) values($1,$2,'MESSAGE_SENT',$3,$4,$5,$6,now(),$7)",
            [
              communicationId,
              `commercial:${job.id}`,
              threadId,
              messageId,
              this.cipher.encrypt(this.gmail.config.userId),
              contact.email_ciphertext,
              stored.objectKey,
            ],
          );
          await client.query(
            "insert into communication_organizations(communication_id,organization_id,contact_id) values($1,$2,$3)",
            [communicationId, organizationId, contact.id],
          );
          await client.query(
            "insert into outbound_email_jobs(id,idempotency_key,source_communication_id,thread_id,recipient_ciphertext,recipient_lookup_hash,subject,message_id,mime_object_key,mime_sha256,state) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING')",
            [
              randomUUID(),
              `commercial:${job.id}`,
              communicationId,
              threadId,
              contact.email_ciphertext,
              contact.email_lookup_hash,
              `Protected ${facts.product_family} opportunity`,
              messageId,
              stored.objectKey,
              stored.sha256,
            ],
          );
          await client.query(
            "update commercial_notification_jobs set state='COMPLETED',completed_at=now(),claimed_at=null where id=$1 and state='PROCESSING'",
            [job.id],
          );
        });
        completed++;
      } catch (error) {
        await this.pool.query(
          "update commercial_notification_jobs set state=case when attempts>=5 then 'FAILED' else 'PENDING' end,completed_at=case when attempts>=5 then now() else null end,claimed_at=null,last_error_code=$2 where id=$1 and state='PROCESSING'",
          [job.id, (error as Error).name.slice(0, 100)],
        );
      }
    }
    return completed;
  }
}
