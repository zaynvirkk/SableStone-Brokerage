import { decimal, type DecimalString } from "./money.js";

export interface AttachmentMetadata {
  readonly filename: string;
  readonly mediaType: string;
  readonly compressedBytes: number;
  readonly expandedBytes: number;
  readonly memberCount: number;
  readonly malwareScan: "CLEAN" | "INFECTED" | "UNAVAILABLE";
  readonly objectKey: string;
}

export type ExtractionStatus = "PROPOSED" | "REJECTED_SECURITY" | "REJECTED_SCHEMA";
export interface InventoryProposal {
  readonly polymer: "PP" | "HDPE" | "LLDPE" | "LDPE";
  readonly application: string;
  readonly colour: string;
  readonly quantityMt: DecimalString;
  readonly mfi: DecimalString;
  readonly supplierNetPerKg: DecimalString;
  readonly currency: string;
  readonly dispatchLocation: string;
  readonly sourceCommunicationId: string;
  readonly humanTextDigest: string;
  readonly verified: false;
}
export interface ExtractionResult {
  readonly status: ExtractionStatus;
  readonly proposal: InventoryProposal | null;
  readonly reasons: readonly string[];
}

const ALLOWED_MEDIA = new Set(["application/pdf", "text/plain", "image/jpeg", "image/png"]);
const INJECTION_MARKERS = [
  "ignore previous", "ignore all previous", "system prompt", "developer message",
  "reveal identity", "waive commission", "approve kyb", "execute tool", "send money",
];

export function assertSafeAttachment(attachment: AttachmentMetadata): void {
  if (!ALLOWED_MEDIA.has(attachment.mediaType)) throw new Error("attachment media type rejected");
  if (!Number.isSafeInteger(attachment.compressedBytes) || attachment.compressedBytes < 0 || attachment.compressedBytes > 20_000_000) {
    throw new Error("attachment compressed size rejected");
  }
  if (!Number.isSafeInteger(attachment.expandedBytes) || attachment.expandedBytes < 0 || attachment.expandedBytes > 100_000_000) {
    throw new Error("attachment expanded size rejected");
  }
  if (attachment.compressedBytes > 0 && attachment.expandedBytes / attachment.compressedBytes > 20) throw new Error("attachment expansion ratio rejected");
  if (!Number.isSafeInteger(attachment.memberCount) || attachment.memberCount < 1 || attachment.memberCount > 100) throw new Error("attachment member count rejected");
  if (attachment.malwareScan !== "CLEAN") throw new Error("clean malware scan required");
  if (!attachment.objectKey.trim()) throw new Error("preserved attachment required");
}

export function extractInventoryProposal(
  communicationId: string,
  body: string,
  bodySha256: string,
  attachments: readonly AttachmentMetadata[],
): ExtractionResult {
  for (const attachment of attachments) {
    try { assertSafeAttachment(attachment); } catch (error) {
      return Object.freeze({ status: "REJECTED_SECURITY", proposal: null, reasons: Object.freeze([(error as Error).message]) });
    }
  }
  if (!/^[0-9a-f]{64}$/.test(bodySha256)) return rejected("REJECTED_SCHEMA", "source communication digest invalid");
  const lower = body.toLocaleLowerCase("en-US");
  if (INJECTION_MARKERS.some((marker) => lower.includes(marker))) return rejected("REJECTED_SECURITY", "instruction-like content is untrusted data");

  const pattern = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(?:mt|t)\s+(PP|HDPE|LLDPE|LDPE)\s+([a-z][a-z -]{1,40})\s+(natural|black|colou?red|light),\s*MFI\s*([0-9]+(?:\.[0-9]+)?),\s*([0-9]+(?:\.[0-9]+)?)\s*(INR|USD)\/kg,\s*([A-Za-z][A-Za-z .-]{1,60})\s*$/i;
  const match = body.match(pattern);
  if (!match) return rejected("REJECTED_SCHEMA", "message does not match bounded inventory grammar");
  const [, quantity, polymer, application, colour, mfi, net, currency, location] = match;
  if (!quantity || !polymer || !application || !colour || !mfi || !net || !currency || !location) {
    return rejected("REJECTED_SCHEMA", "required extracted field missing");
  }
  const proposal: InventoryProposal = Object.freeze({
    polymer: polymer.toUpperCase() as InventoryProposal["polymer"],
    application: application.trim(), colour: colour.toLowerCase(), quantityMt: decimal(quantity),
    mfi: decimal(mfi), supplierNetPerKg: decimal(net), currency: currency.toUpperCase(),
    dispatchLocation: location.trim(), sourceCommunicationId: communicationId,
    humanTextDigest: bodySha256, verified: false,
  });
  return Object.freeze({ status: "PROPOSED", proposal, reasons: Object.freeze([]) });
}

function rejected(status: Exclude<ExtractionStatus, "PROPOSED">, reason: string): ExtractionResult {
  return Object.freeze({ status, proposal: null, reasons: Object.freeze([reason]) });
}
