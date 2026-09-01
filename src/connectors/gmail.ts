import { createHash } from "node:crypto";
import { google, type gmail_v1 } from "googleapis";
import { simpleParser } from "mailparser";
import type { EmailEvent, OutboundEmail } from "../email.js";
import type { ReceiptWriter } from "./discovery_http.js";
import type { CredentialUseGuard } from "../runtime/production_credentials.js";
export interface GmailProductionConfig {
  readonly userId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly pubsubTopic: string;
  readonly pushAudience: string;
  readonly authorized: boolean;
}
export interface GmailPushBody {
  readonly message: {
    readonly messageId: string;
    readonly publishTime: string;
    readonly data: string;
  };
  readonly subscription: string;
}
export class GmailProductionConnector {
  readonly gmail: gmail_v1.Gmail;
  constructor(
    readonly config: GmailProductionConfig,
    readonly store: ReceiptWriter,
    gmail?: gmail_v1.Gmail,
    readonly credentialGuard?: CredentialUseGuard,
  ) {
    if (!config.authorized) throw new Error("production Gmail unavailable");
    if (
      !config.clientId ||
      !config.clientSecret ||
      !config.refreshToken ||
      !config.userId
    )
      throw new Error("Gmail credentials incomplete");
    if (gmail) this.gmail = gmail;
    else {
      const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
      auth.setCredentials({ refresh_token: config.refreshToken });
      this.gmail = google.gmail({ version: "v1", auth });
    }
  }
  async startWatch(): Promise<{ historyId: bigint; expiration: string }> {
    await this.credentialGuard?.assertCurrent();
    const result = await this.gmail.users.watch({
      userId: this.config.userId,
      requestBody: { topicName: this.config.pubsubTopic, labelIds: ["INBOX"] },
    });
    if (!result.data.historyId || !result.data.expiration)
      throw new Error("Gmail watch acknowledgement incomplete");
    return {
      historyId: BigInt(result.data.historyId),
      expiration: result.data.expiration,
    };
  }
  async ingestPush(
    body: GmailPushBody,
    authenticatedAudience: string,
    fromExclusive: bigint,
  ): Promise<{ toInclusive: bigint; events: readonly EmailEvent[] }> {
    await this.credentialGuard?.assertCurrent();
    if (authenticatedAudience !== this.config.pushAudience)
      throw new Error("Gmail push audience invalid");
    const decoded = JSON.parse(
      Buffer.from(body.message.data, "base64").toString("utf8"),
    ) as { emailAddress?: string; historyId?: string };
    if (decoded.emailAddress !== this.config.userId || !decoded.historyId)
      throw new Error("Gmail push scope invalid");
    const toInclusive = BigInt(decoded.historyId);
    if (toInclusive <= fromExclusive)
      return { toInclusive, events: Object.freeze([]) };
    const messageIds: string[] = [];
    let pageToken: string | undefined;
    do {
      const params: gmail_v1.Params$Resource$Users$History$List = {
        userId: this.config.userId,
        startHistoryId: fromExclusive.toString(),
        historyTypes: ["messageAdded"],
      };
      if (pageToken) params.pageToken = pageToken;
      const response = await this.gmail.users.history.list(params);
      for (const history of response.data.history ?? [])
        for (const added of history.messagesAdded ?? [])
          if (added.message?.id) messageIds.push(added.message.id);
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
    const events = [];
    for (const id of [...new Set(messageIds)])
      events.push(await this.fetchMessage(id, body.message.publishTime));
    return { toInclusive, events: Object.freeze(events) };
  }
  async fetchMessage(
    messageId: string,
    receivedAt: string,
  ): Promise<EmailEvent> {
    await this.credentialGuard?.assertCurrent();
    const response = await this.gmail.users.messages.get({
        userId: this.config.userId,
        id: messageId,
        format: "raw",
      }),
      raw = response.data.raw;
    if (!raw || !response.data.threadId)
      throw new Error("Gmail raw message incomplete");
    const bytes = Buffer.from(
        raw.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ),
      receipt = await this.store.preserve(
        "email/inbound",
        bytes,
        "message/rfc822",
        `gmail:${messageId}`,
        receivedAt,
      ),
      parsed = await simpleParser(bytes),
      sender = parsed.from?.value[0]?.address,
      recipient =
        parsed.to && "value" in parsed.to
          ? parsed.to.value[0]?.address
          : undefined;
    if (!sender || !recipient) throw new Error("Gmail message parties missing");
    return Object.freeze({
      externalEventId: `gmail:${messageId}`,
      type: "MESSAGE_RECEIVED",
      threadId: response.data.threadId,
      messageId,
      sender,
      recipient,
      occurredAt: parsed.date?.toISOString() ?? receivedAt,
      payloadObjectKey: receipt.objectKey,
      payloadSha256: receipt.sha256,
    });
  }
  async send(
    message: OutboundEmail,
    body: Uint8Array,
  ): Promise<{ messageId: string; threadId: string; receiptId: string }> {
    await this.credentialGuard?.assertCurrent();
    if (!message.idempotencyKey.trim())
      throw new Error("Gmail idempotency key required");
    const deterministicMessageId = `<${createHash("sha256").update(message.idempotencyKey).digest("hex")}@mail.sablestone.internal>`;
    if (
      message.messageId !== deterministicMessageId ||
      !new TextDecoder()
        .decode(body)
        .includes(`Message-ID: ${deterministicMessageId}`)
    )
      throw new Error("deterministic outbound Message-ID missing");
    const prior = await this.gmail.users.messages.list({
      userId: this.config.userId,
      q: `rfc822msgid:${deterministicMessageId} in:sent`,
      maxResults: 1,
    });
    if (prior.data.messages?.[0]?.id) {
      const found = await this.gmail.users.messages.get({
        userId: this.config.userId,
        id: prior.data.messages[0].id,
        format: "metadata",
      });
      if (!found.data.id || !found.data.threadId)
        throw new Error("Gmail idempotency lookup incomplete");
      return {
        messageId: found.data.id,
        threadId: found.data.threadId,
        receiptId: message.bodyObjectKey,
      };
    }
    const receipt = await this.store.preserve(
        "email/outbound",
        body,
        "message/rfc822",
        `outbound:${message.idempotencyKey}`,
      ),
      raw = Buffer.from(body).toString("base64url"),
      requestBody: gmail_v1.Schema$Message = { raw };
    if (message.threadId) requestBody.threadId = message.threadId;
    const response = await this.gmail.users.messages.send({
      userId: this.config.userId,
      requestBody,
    });
    if (!response.data.id || !response.data.threadId)
      throw new Error(
        `Gmail send acknowledgement incomplete; receipt=${receipt.objectKey}`,
      );
    return {
      messageId: response.data.id,
      threadId: response.data.threadId,
      receiptId: receipt.objectKey,
    };
  }
}
export function gmailEventDigest(event: EmailEvent): string {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}
