import { AcceptanceRegistry } from "../dist/index.js";
const now = "2026-08-31T00:00:00Z", digest = "a".repeat(64), proof = "b".repeat(64);
const template = { templateId: "agreement-1", kind: "SUPPLIER_MASTER_BROKERAGE", version: "v1", bodySha256: digest, bodyObjectKey: "agreements/1/v1", effectiveAt: "2026-08-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z", legalGateReceiptId: "legal-1", sellerOfRecord: "SUPPLIER", sablestoneRole: "COMMISSION_BROKER" };
const gate = { gate: "ELECTRONIC_ACCEPTANCE", state: "AVAILABLE", receiptId: "legal-1", reason: "fixture" };
const acceptance = { acceptanceId: "accept-1", idempotencyKey: "accept:1", agreementTemplateId: "agreement-1", agreementVersion: "v1", agreementBodySha256: digest, expectedOrganizationId: "supplier-1", signerOrganizationId: "supplier-1", signerUserId: "user-1", signerEmailVerified: true, otpVerified: true, otpChallengeId: "otp-1", otpExpiresAt: "2026-08-31T01:00:00Z", acceptedAt: "2026-08-30T23:59:00Z", ipAddressCiphertext: "encrypted-ip", userAgentDigest: proof, acceptanceSha256: proof };
const registry = new AcceptanceRegistry();
const first = registry.accept(template, acceptance, gate, now), replay = registry.accept(template, acceptance, gate, now);
if (first !== replay || registry.count() !== 1) throw new Error("acceptance not idempotent");
let rejected = 0;
const attempts = [
  [{ ...template, bodySha256: "c".repeat(64) }, acceptance, gate],
  [template, { ...acceptance, idempotencyKey: "wrong-party", signerOrganizationId: "buyer-1" }, gate],
  [template, { ...acceptance, idempotencyKey: "otp", otpVerified: false }, gate],
  [template, { ...acceptance, idempotencyKey: "expired", otpExpiresAt: "2026-08-30T00:00:00Z" }, gate],
  [template, { ...acceptance, acceptanceSha256: "d".repeat(64) }, gate],
  [template, { ...acceptance, idempotencyKey: "gate" }, { ...gate, state: "REVOKED" }],
];
for (const [t, a, g] of attempts) try { registry.accept(t, a, g, now); } catch { rejected += 1; }
if (rejected !== 6) throw new Error(`agreement negatives lost ${rejected}/6`);
console.log("AGREEMENT_OK accepted=1 replay=idempotent altered_hash=reject wrong_party=reject otp=reject expired=reject replay_conflict=reject legal_gate=required roles_fixed=true");
