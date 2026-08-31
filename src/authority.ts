import type { CapabilityState } from "./config.js";

export type AuthorityKind =
  | "OFFICIAL_LAW"
  | "OFFICIAL_REGISTRY"
  | "PROFESSIONAL_LEGAL_MEMO"
  | "PROFESSIONAL_TAX_MEMO"
  | "PROVIDER_WRITTEN_APPROVAL"
  | "PROVIDER_PUBLIC_DOCUMENTATION"
  | "MARKETING_PAGE";

export interface AuthorityReceipt {
  readonly receiptId: string;
  readonly kind: AuthorityKind;
  readonly canonicalUrl: string;
  readonly retrievedAt: string;
  readonly bodySha256: string;
  readonly bodyObjectKey: string;
  readonly jurisdiction: string;
  readonly proposition: string;
  readonly effectiveAt: string;
  readonly reviewAt: string;
  readonly expiresAt: string;
  readonly reviewedBy: string;
  readonly sourceVersion: string;
}

export type GateName =
  | "BROKER_NOT_SELLER"
  | "GST_TAX"
  | "PRIVACY_OUTREACH"
  | "ELECTRONIC_ACCEPTANCE"
  | "SETTLEMENT_USE_CASE";

const gateKinds: Readonly<Record<GateName, readonly AuthorityKind[]>> = Object.freeze({
  BROKER_NOT_SELLER: ["PROFESSIONAL_LEGAL_MEMO"],
  GST_TAX: ["PROFESSIONAL_TAX_MEMO"],
  PRIVACY_OUTREACH: ["PROFESSIONAL_LEGAL_MEMO"],
  ELECTRONIC_ACCEPTANCE: ["PROFESSIONAL_LEGAL_MEMO"],
  SETTLEMENT_USE_CASE: ["PROVIDER_WRITTEN_APPROVAL"],
});

export interface GateEvaluation {
  readonly gate: GateName;
  readonly state: CapabilityState;
  readonly receiptId: string | null;
  readonly reason: string;
}

export function assertAuthorityReceipt(receipt: AuthorityReceipt): void {
  if (!/^https:\/\//.test(receipt.canonicalUrl)) throw new Error("authority URL must use HTTPS");
  if (!/^[0-9a-f]{64}$/.test(receipt.bodySha256)) throw new Error("authority body digest invalid");
  if (!receipt.bodyObjectKey.trim()) throw new Error("preserved source body required");
  if (!receipt.proposition.trim() || !receipt.jurisdiction.trim()) throw new Error("bounded proposition required");
  if (!receipt.reviewedBy.trim()) throw new Error("review attribution required");
  for (const time of [receipt.retrievedAt, receipt.effectiveAt, receipt.reviewAt, receipt.expiresAt]) {
    if (Number.isNaN(Date.parse(time))) throw new Error("authority time invalid");
  }
  if (Date.parse(receipt.reviewAt) < Date.parse(receipt.retrievedAt)) throw new Error("review precedes retrieval");
  if (Date.parse(receipt.expiresAt) <= Date.parse(receipt.reviewAt)) throw new Error("receipt expires before review");
}

export function evaluateGate(
  gate: GateName,
  receipts: readonly AuthorityReceipt[],
  now: string,
  currentSourceDigests: Readonly<Record<string, string>>,
): GateEvaluation {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) throw new Error("evaluation time invalid");
  const allowed = gateKinds[gate];
  const candidates = receipts.filter((receipt) => allowed.includes(receipt.kind));
  if (candidates.length === 0) {
    return Object.freeze({ gate, state: "UNAVAILABLE", receiptId: null, reason: "required reviewed authority missing" });
  }
  const current = candidates
    .filter((receipt) => {
      try { assertAuthorityReceipt(receipt); } catch { return false; }
      return Date.parse(receipt.effectiveAt) <= nowMs && nowMs < Date.parse(receipt.expiresAt);
    })
    .find((receipt) => currentSourceDigests[receipt.canonicalUrl] === receipt.bodySha256);
  if (!current) {
    return Object.freeze({ gate, state: "REVOKED", receiptId: null, reason: "authority expired invalid or source drifted" });
  }
  return Object.freeze({ gate, state: "AVAILABLE", receiptId: current.receiptId, reason: "current reviewed receipt" });
}
