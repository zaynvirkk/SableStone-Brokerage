import type { GateEvaluation } from "./authority.js";

export type AgreementKind = "SUPPLIER_MASTER_BROKERAGE" | "BUYER_ACCESS_TERMS" | "PROTECTED_ACCOUNT_NOTICE" | "PROTECTED_SUPPLIER_ACKNOWLEDGEMENT" | "TRANSACTION_CONFIRMATION" | "SETTLEMENT_INSTRUCTIONS";
export interface AgreementTemplate {
  readonly templateId: string;
  readonly kind: AgreementKind;
  readonly version: string;
  readonly bodySha256: string;
  readonly bodyObjectKey: string;
  readonly effectiveAt: string;
  readonly expiresAt: string;
  readonly legalGateReceiptId: string;
  readonly sellerOfRecord: "SUPPLIER";
  readonly sablestoneRole: "COMMISSION_BROKER";
}
export interface AgreementAcceptance {
  readonly acceptanceId: string;
  readonly idempotencyKey: string;
  readonly agreementTemplateId: string;
  readonly agreementVersion: string;
  readonly agreementBodySha256: string;
  readonly expectedOrganizationId: string;
  readonly signerOrganizationId: string;
  readonly signerUserId: string;
  readonly signerEmailVerified: boolean;
  readonly otpVerified: boolean;
  readonly otpChallengeId: string;
  readonly otpExpiresAt: string;
  readonly acceptedAt: string;
  readonly ipAddressCiphertext: string;
  readonly userAgentDigest: string;
  readonly acceptanceSha256: string;
}

export function assertAgreementTemplate(template: AgreementTemplate, legalGate: GateEvaluation, now: string): void {
  if (legalGate.state !== "AVAILABLE" || legalGate.receiptId !== template.legalGateReceiptId) throw new Error("current legal gate required");
  for (const digest of [template.bodySha256]) if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("agreement digest invalid");
  if (!template.bodyObjectKey.trim()) throw new Error("agreement body required");
  if (Date.parse(now) < Date.parse(template.effectiveAt) || Date.parse(now) >= Date.parse(template.expiresAt)) throw new Error("agreement template not current");
  if (template.sellerOfRecord !== "SUPPLIER" || template.sablestoneRole !== "COMMISSION_BROKER") throw new Error("commercial role boundary changed");
}

export class AcceptanceRegistry {
  readonly #byIdempotency = new Map<string, Readonly<AgreementAcceptance>>();
  accept(template: AgreementTemplate, acceptance: AgreementAcceptance, legalGate: GateEvaluation, now: string): Readonly<AgreementAcceptance> {
    assertAgreementTemplate(template, legalGate, now);
    if (!acceptance.idempotencyKey.trim()) throw new Error("acceptance idempotency key required");
    if (acceptance.agreementTemplateId !== template.templateId || acceptance.agreementVersion !== template.version || acceptance.agreementBodySha256 !== template.bodySha256) throw new Error("accepted agreement version or digest mismatch");
    const previous = this.#byIdempotency.get(acceptance.idempotencyKey);
    if (previous) {
      if (previous.acceptanceSha256 !== acceptance.acceptanceSha256) throw new Error("acceptance replay conflict");
      return previous;
    }
    if (acceptance.signerOrganizationId !== acceptance.expectedOrganizationId) throw new Error("wrong party acceptance");
    if (!acceptance.signerEmailVerified || !acceptance.otpVerified || !acceptance.otpChallengeId.trim()) throw new Error("verified signer and OTP required");
    if (Date.parse(acceptance.acceptedAt) > Date.parse(now) || Date.parse(acceptance.acceptedAt) >= Date.parse(acceptance.otpExpiresAt) || Date.parse(now) >= Date.parse(acceptance.otpExpiresAt)) throw new Error("acceptance or OTP expired/invalid");
    if (!acceptance.ipAddressCiphertext.trim() || !/^[0-9a-f]{64}$/.test(acceptance.userAgentDigest) || !/^[0-9a-f]{64}$/.test(acceptance.acceptanceSha256)) throw new Error("acceptance audit proof invalid");
    const stored = Object.freeze({ ...acceptance }); this.#byIdempotency.set(acceptance.idempotencyKey, stored); return stored;
  }
  count(): number { return this.#byIdempotency.size; }
}
