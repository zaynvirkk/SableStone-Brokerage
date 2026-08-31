import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";
import { compareDecimalStrings } from "../domain.js";
import { decimal, type DecimalString } from "../money.js";
export type MessageClass =
  | "SUPPLIER_OFFER"
  | "BUYER_RFQ"
  | "COUNTEROFFER"
  | "DOCUMENT"
  | "EXCEPTION";
export interface BuyerDemandProposal {
  readonly material: string;
  readonly quantityMt: DecimalString;
  readonly destination: string;
  readonly mfiMin: DecimalString | null;
  readonly mfiMax: DecimalString | null;
  readonly ceilingPerKg: DecimalString | null;
  readonly currency: string | null;
  readonly sourceMessageDigest: string;
  readonly verified: false;
}
export interface SupplierOfferProposal {
  readonly material: string;
  readonly quantityMt: DecimalString;
  readonly moqMt: DecimalString;
  readonly netPerKg: DecimalString;
  readonly currency: string;
  readonly mfiMin: DecimalString | null;
  readonly mfiMax: DecimalString | null;
  readonly sourceMessageDigest: string;
  readonly verified: false;
}
export interface CommunicationDecision {
  readonly classification: MessageClass;
  readonly state:
    | "PROPOSED"
    | "REQUEST_MISSING_FIELDS"
    | "DECLINE"
    | "ROUTE_DOCUMENTS";
  readonly supplierText: string | null;
  readonly offer: SupplierOfferProposal | null;
  readonly demand: BuyerDemandProposal | null;
  readonly replyBody: string;
  readonly reasons: readonly string[];
}
const forbidden =
  /finance|credit\s*(?:us|me)|waive\s+(?:the\s+)?commission|change\s+(?:the\s+)?contract|reveal\s+(?:the\s+)?(?:buyer|supplier)/i;
export async function classifyInboundMime(
  raw: Uint8Array,
): Promise<CommunicationDecision> {
  const parsed = await simpleParser(Buffer.from(raw)),
    text = (parsed.text ?? "").trim(),
    digest = createHash("sha256").update(raw).digest("hex"),
    demand = parseDemand(text, digest),
    offer = parseOffer(text, digest);
  if (forbidden.test(text))
    return decision(
      "EXCEPTION",
      "DECLINE",
      null,
      null,
      null,
      "This request is outside SableStone's permitted brokerage policy and cannot be accepted.",
      ["OUTSIDE_POLICY"],
    );
  if (parsed.attachments.length)
    return decision(
      "DOCUMENT",
      "ROUTE_DOCUMENTS",
      offer ? text : null,
      offer,
      demand,
      "Your documents and any complete commercial requirement were recorded. All facts remain source-stated until independent verification completes.",
      [],
    );
  if (demand)
    return decision(
      "BUYER_RFQ",
      "PROPOSED",
      null,
      null,
      demand,
      "Your requirement was recorded as an unverified proposal. We will respond only if current verified inventory and an approved settlement rail are compatible.",
      [],
    );
  if (offer)
    return decision(
      "SUPPLIER_OFFER",
      "PROPOSED",
      text,
      offer,
      null,
      "Your inventory was recorded as an unverified proposal. Registration, specifications and current documents must pass before activation.",
      [],
    );
  if (
    /^\s*[0-9]+(?:\.[0-9]+)?\s*(?:mt|t)\s+(?:r?PP|r?HDPE|r?LLDPE|r?LDPE)\b/i.test(
      text,
    )
  )
    return decision(
      "SUPPLIER_OFFER",
      "REQUEST_MISSING_FIELDS",
      text,
      null,
      null,
      "Please provide quantity, material, NET price per kg, currency, MOQ and—where applicable—MFI range. The offer cannot activate until these fields and current documents are verified.",
      ["INCOMPLETE_SUPPLIER_OFFER"],
    );
  if (
    /^\s*(?:accept|accepted)\s*[.!]?\s*$/i.test(text) ||
    /(?:₹|INR\s*|USD\s*)[0-9]+(?:\.[0-9]+)?(?:\/kg)?/i.test(text)
  )
    return decision(
      "COUNTEROFFER",
      "PROPOSED",
      text,
      null,
      null,
      "Your counteroffer was recorded. Only the current deterministic price envelope can accept or counter it.",
      [],
    );
  return decision(
    "EXCEPTION",
    "REQUEST_MISSING_FIELDS",
    null,
    null,
    null,
    "Please provide material, application, quantity in MT, specification range, destination, required date and—if available—your maximum price per kg.",
    ["UNCLASSIFIED_OR_INCOMPLETE"],
  );
}
export function parseCommercialIntent(
  text: string,
): Readonly<
  | { type: "ACCEPT" }
  | { type: "COUNTER_PRICE"; pricePerKg: DecimalString; currency: string }
> | null {
  if (/^\s*(?:accept|accepted)\s*[.!]?\s*$/i.test(text))
    return Object.freeze({ type: "ACCEPT" as const });
  const match = text.match(
    /(?:₹|INR\s*|USD\s*)([0-9]+(?:\.[0-9]+)?)\s*(?:INR|USD)?(?:\/kg)?/i,
  );
  if (!match) return null;
  return Object.freeze({
    type: "COUNTER_PRICE" as const,
    pricePerKg: decimal(match[1]!),
    currency: /USD/i.test(match[0]) ? "USD" : "INR",
  });
}
function parseOffer(
  text: string,
  digest: string,
): SupplierOfferProposal | null {
  const head = text.match(
      /^\s*([0-9]+(?:\.[0-9]+)?)\s*(?:mt|t)\s+(r?(?:PP|HDPE|LLDPE|LDPE)(?:\s+[a-z /-]{1,40})?)/i,
    ),
    net = text.match(
      /\bnet(?:\s+price)?\s*(?:₹|INR|USD)?\s*([0-9]+(?:\.[0-9]+)?)\s*(INR|USD)?(?:\/kg)?/i,
    ),
    moq = text.match(/\bMOQ\s*([0-9]+(?:\.[0-9]+)?)\s*(?:mt|t)\b/i),
    mfi = text.match(
      /\bMFI\s*([0-9]+(?:\.[0-9]+)?)(?:\s*[-–]\s*([0-9]+(?:\.[0-9]+)?))?/i,
    );
  if (!head || !net || !moq) return null;
  const quantity = decimal(head[1]!),
    minimum = decimal(moq[1]!);
  if (compareDecimalStrings(minimum, quantity) > 0) return null;
  return Object.freeze({
    material: head[2]!.trim(),
    quantityMt: quantity,
    moqMt: minimum,
    netPerKg: decimal(net[1]!),
    currency: net[2]?.toUpperCase() ?? (/₹/.test(net[0]) ? "INR" : "INR"),
    mfiMin: mfi ? decimal(mfi[1]!) : null,
    mfiMax: mfi ? decimal(mfi[2] ?? mfi[1]!) : null,
    sourceMessageDigest: digest,
    verified: false,
  });
}
function parseDemand(text: string, digest: string): BuyerDemandProposal | null {
  const match = text.match(
    /(?:need|require|buying)\s+([0-9]+(?:\.[0-9]+)?)\s*(?:mt|t)\s+([a-z0-9 /-]{2,50}?)(?:,|\s+to\s+)\s*([a-z][a-z .-]{1,50})(?:,?\s*MFI\s*([0-9]+(?:\.[0-9]+)?)\s*[-–]\s*([0-9]+(?:\.[0-9]+)?))?(?:,?\s*(?:max|ceiling)\s*(?:₹|INR\s*)?([0-9]+(?:\.[0-9]+)?)\s*(INR|USD)?(?:\/kg)?)?/i,
  );
  if (!match) return null;
  const [, qty, material, destination, min, max, ceiling, currency] = match;
  if (!qty || !material || !destination) return null;
  return Object.freeze({
    material: material.trim(),
    quantityMt: decimal(qty),
    destination: destination.trim(),
    mfiMin: min ? decimal(min) : null,
    mfiMax: max ? decimal(max) : null,
    ceilingPerKg: ceiling ? decimal(ceiling) : null,
    currency: ceiling ? (currency?.toUpperCase() ?? "INR") : null,
    sourceMessageDigest: digest,
    verified: false,
  });
}
function decision(
  classification: MessageClass,
  state: CommunicationDecision["state"],
  supplierText: string | null,
  offer: SupplierOfferProposal | null,
  demand: BuyerDemandProposal | null,
  replyBody: string,
  reasons: readonly string[],
): CommunicationDecision {
  return Object.freeze({
    classification,
    state,
    supplierText,
    offer,
    demand,
    replyBody,
    reasons: Object.freeze([...reasons]),
  });
}
export function createReplyMime(input: {
  from: string;
  to: string;
  subject: string;
  inReplyTo: string;
  messageId?: string;
  body: string;
}): Uint8Array {
  for (const value of [
    input.from,
    input.to,
    input.subject,
    input.inReplyTo,
    input.messageId ?? "",
  ])
    if (/[\r\n]/.test(value))
      throw new Error("email header injection rejected");
  if (
    input.messageId &&
    !/^<[0-9a-f]{64}@mail\.sablestone\.internal>$/.test(input.messageId)
  )
    throw new Error("outbound Message-ID invalid");
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `In-Reply-To: ${input.inReplyTo}`,
    ...(input.messageId ? [`Message-ID: ${input.messageId}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
  ];
  return new TextEncoder().encode(lines.join("\r\n"));
}
