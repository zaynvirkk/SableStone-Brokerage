import { OAuth2Client } from "google-auth-library";
import { createHash } from "node:crypto";
import type { DurableInboxRepository } from "./database.js";
import type { ReceiptWriter } from "../connectors/discovery_http.js";
import type {
  GmailProductionConnector,
  GmailPushBody,
} from "../connectors/gmail.js";
import type { ProductionSettlementHttpAdapter } from "../connectors/settlement_http.js";
export interface HistoryCursorRepository {
  get(mailbox: string): Promise<bigint>;
  advance(mailbox: string, expected: bigint, next: bigint): Promise<boolean>;
}
export function createGmailPushHandler(input: {
  connector: GmailProductionConnector;
  store: ReceiptWriter;
  inbox: DurableInboxRepository;
  cursors: HistoryCursorRepository;
  oidc: OAuth2Client;
  audience: string;
  expectedServiceAccountEmail: string;
}) {
  return async (
    raw: Uint8Array,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<string> => {
    const authorization = headers["authorization"];
    if (!authorization?.startsWith("Bearer "))
      throw new Error("Gmail push bearer missing");
    const ticket = await input.oidc.verifyIdToken({
        idToken: authorization.slice(7),
        audience: input.audience,
      }),
      payload = ticket.getPayload();
    if (
      !payload?.email_verified ||
      !input.expectedServiceAccountEmail ||
      payload.email !== input.expectedServiceAccountEmail
    )
      throw new Error("Gmail push identity unverified");
    const body = JSON.parse(new TextDecoder().decode(raw)) as GmailPushBody,
      pushReceipt = await input.store.preserve(
        "webhooks/gmail",
        raw,
        "application/json",
        "google-pubsub",
        body.message.publishTime,
      ),
      from = await input.cursors.get(input.connector.config.userId),
      history = await input.connector.ingestPush(body, input.audience, from);
    for (const event of history.events) {
      const bytes = new TextEncoder().encode(JSON.stringify(event)),
        receipt = await input.store.preserve(
          "webhooks/gmail/events",
          bytes,
          "application/json",
          event.externalEventId,
          event.occurredAt,
        );
      await input.inbox.insert({
        provider: "GMAIL",
        externalEventId: event.externalEventId,
        payloadDigest: receipt.sha256,
        payloadObjectKey: receipt.objectKey,
        receivedAt: event.occurredAt,
        signatureVerified: true,
      });
    }
    if (
      !(await input.cursors.advance(
        input.connector.config.userId,
        from,
        history.toInclusive,
      ))
    )
      throw new Error("Gmail history cursor conflict");
    return pushReceipt.sha256;
  };
}
export function createSettlementWebhookHandler(input: {
  adapter: ProductionSettlementHttpAdapter;
  store: ReceiptWriter;
  inbox: DurableInboxRepository;
  signatureHeader: string;
  eventIdPath: string;
}) {
  return async (
    raw: Uint8Array,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<string> => {
    const receivedAt = new Date().toISOString(),
      rawReceipt = await input.store.preserve(
        `webhooks/${input.adapter.provider}/raw`,
        raw,
        "application/json",
        input.adapter.provider,
        receivedAt,
      ),
      rawDecoded = JSON.parse(new TextDecoder().decode(raw)) as Record<
        string,
        unknown
      >,
      eventId = input.eventIdPath
        .split(".")
        .reduce<unknown>(
          (value, key) =>
            value && typeof value === "object"
              ? (value as Record<string, unknown>)[key]
              : undefined,
          rawDecoded,
        ),
      verified = await input.adapter.verifyWebhook(raw, headers),
      receipt = await input.store.preserve(
        `webhooks/${input.adapter.provider}/verified`,
        verified,
        "application/json",
        input.adapter.provider,
        receivedAt,
      ),
      decoded = JSON.parse(new TextDecoder().decode(verified)) as Record<
        string,
        unknown
      >;
    void decoded;
    if (
      (typeof eventId !== "string" && typeof eventId !== "number") ||
      !String(eventId).trim()
    )
      throw new Error("settlement event id missing");
    await input.inbox.insert({
      provider: input.adapter.provider,
      externalEventId: String(eventId),
      payloadDigest: receipt.sha256,
      payloadObjectKey: receipt.objectKey,
      receivedAt,
      signatureVerified: true,
    });
    void rawReceipt;
    return String(eventId);
  };
}
