import { evaluateGate } from "../dist/index.js";
const digest = "a".repeat(64);
const base = {
  receiptId: "receipt-1", kind: "PROFESSIONAL_LEGAL_MEMO",
  canonicalUrl: "https://counsel.example/memo/1", retrievedAt: "2026-08-01T00:00:00Z",
  bodySha256: digest, bodyObjectKey: "authority/receipt-1", jurisdiction: "IN",
  proposition: "Exact fixture brokerage flow does not make fixture broker seller solely by brokering",
  effectiveAt: "2026-08-01T00:00:00Z", reviewAt: "2026-08-02T00:00:00Z",
  expiresAt: "2026-12-01T00:00:00Z", reviewedBy: "fixture-counsel", sourceVersion: "v1",
};
const now = "2026-08-31T00:00:00Z";
const available = evaluateGate("BROKER_NOT_SELLER", [base], now, { [base.canonicalUrl]: digest });
if (available.state !== "AVAILABLE") throw new Error("valid fixture authority rejected");
const marketing = evaluateGate("BROKER_NOT_SELLER", [{ ...base, kind: "MARKETING_PAGE" }], now, { [base.canonicalUrl]: digest });
const publicDocs = evaluateGate("SETTLEMENT_USE_CASE", [{ ...base, kind: "PROVIDER_PUBLIC_DOCUMENTATION" }], now, { [base.canonicalUrl]: digest });
const drift = evaluateGate("BROKER_NOT_SELLER", [base], now, { [base.canonicalUrl]: "b".repeat(64) });
const expired = evaluateGate("BROKER_NOT_SELLER", [base], "2027-01-01T00:00:00Z", { [base.canonicalUrl]: digest });
if (marketing.state !== "UNAVAILABLE" || publicDocs.state !== "UNAVAILABLE" || drift.state !== "REVOKED" || expired.state !== "REVOKED") {
  throw new Error("authority fail-closed semantics lost");
}
console.log("AUTHORITY_OK marketing_not_approval=true public_docs_not_underwriting=true drift_revokes=true expiry_revokes=true");
