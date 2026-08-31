import { decimal, evaluateProviderCapability, assertAdapterAvailable } from "../dist/index.js";
const now = "2026-08-31T00:00:00Z", required = ["BROKER_FEE_SPLIT", "CONDITIONAL_RELEASE"];
const approval = { approvalId: "approval-1", provider: "FIXTURE_RAIL", environment: "SANDBOX", writtenApprovalReceiptId: "receipt-1", actualUseCase: "synthetic polymer broker split fixture only", commodityFamilies: ["RPP_NATURAL_LIGHT_INJECTION"], currencies: ["INR"], minimumGross: decimal("1"), maximumGross: decimal("10000000"), capabilities: [...required, "REFUND_ALLOCATION"], validFrom: "2026-08-01T00:00:00Z", validUntil: "2026-12-01T00:00:00Z", state: "APPROVED" };
const credentials = { provider: "FIXTURE_RAIL", environment: "SANDBOX", state: "VALID", secretReference: "secret://fixture-only", verifiedAt: "2026-08-30T00:00:00Z" };
const pass = evaluateProviderCapability(approval, credentials, required, now); assertAdapterAvailable(pass);
const missingApproval = evaluateProviderCapability(null, credentials, required, now);
const missingCreds = evaluateProviderCapability(approval, { ...credentials, state: "MISSING", secretReference: null }, required, now);
const underReview = evaluateProviderCapability({ ...approval, state: "UNDER_REVIEW" }, credentials, required, now);
const missingCapability = evaluateProviderCapability({ ...approval, capabilities: ["BROKER_FEE_SPLIT"] }, credentials, required, now);
const publicDocsOnly = evaluateProviderCapability(null, credentials, required, now);
if (missingApproval.state !== "UNAVAILABLE" || missingCreds.state !== "UNAVAILABLE" || underReview.state !== "UNDER_REVIEW" || missingCapability.state !== "UNAVAILABLE" || publicDocsOnly.state !== "UNAVAILABLE") throw new Error("settlement capability failed open");
let blocked = 0; for (const value of [missingApproval, missingCreds, underReview]) try { assertAdapterAvailable(value); } catch { blocked += 1; }
if (blocked !== 3) throw new Error("adapter availability bypass");
console.log("SETTLEMENT_CAPABILITY_OK sandbox_available=true missing_approval=unavailable missing_credentials=unavailable under_review=blocked public_docs=not_approval capabilities_exact=true");
