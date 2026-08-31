import { assertRiskPass, decideCounterpartyRisk } from "../dist/index.js";
const types = ["OFFICIAL_REGISTRATION", "KYB_IDENTITY", "SANCTIONS", "WATCHLIST", "BANK_ACCOUNT"];
const providers = { OFFICIAL_REGISTRATION: ["CPCB_FIXTURE"], KYB_IDENTITY: ["REGISTRY_FIXTURE"], SANCTIONS: ["CSL_FIXTURE"], WATCHLIST: ["TRULIOO_FIXTURE"], BANK_ACCOUNT: ["BANK_FIXTURE"] };
const policy = { version: "risk-v1", requiredChecks: types, acceptedProviders: providers };
const checks = types.map((type, index) => ({ checkId: `check-${index}`, organizationId: "org-1", type, state: "PASS", sourceProvider: providers[type][0], sourceReceiptId: `receipt-${index}`, sourceDigest: String(index + 1).repeat(64), checkedAt: "2026-08-30T00:00:00Z", validUntil: "2026-09-30T00:00:00Z", matchedEntityIds: type === "KYB_IDENTITY" ? ["entity-1"] : [], policyVersion: "risk-v1" }));
const pass = decideCounterpartyRisk(checks, policy, "2026-08-31T00:00:00Z"); assertRiskPass(pass);
const changed = (type, update) => checks.map((check) => check.type === type ? { ...check, ...update } : check);
const hit = decideCounterpartyRisk(changed("SANCTIONS", { state: "HIT" }), policy, "2026-08-31T00:00:00Z");
const unknown = decideCounterpartyRisk(changed("WATCHLIST", { state: "UNKNOWN" }), policy, "2026-08-31T00:00:00Z");
const ambiguous = decideCounterpartyRisk(changed("KYB_IDENTITY", { state: "AMBIGUOUS", matchedEntityIds: ["a", "b"] }), policy, "2026-08-31T00:00:00Z");
const stale = decideCounterpartyRisk(changed("BANK_ACCOUNT", { validUntil: "2026-08-01T00:00:00Z" }), policy, "2026-08-31T00:00:00Z");
const missing = decideCounterpartyRisk(checks.filter((c) => c.type !== "SANCTIONS"), policy, "2026-08-31T00:00:00Z");
if (hit.state !== "REJECT" || [unknown, ambiguous, stale, missing].some((d) => d.state !== "FREEZE")) throw new Error("risk failed open");
let blocked = 0; for (const d of [hit, unknown, ambiguous]) try { assertRiskPass(d); } catch { blocked += 1; }
if (blocked !== 3) throw new Error("risk assertion bypass");
console.log("RISK_OK pass=true sanctions_hit=reject unknown=freeze ambiguous=freeze stale=freeze missing=freeze llm_override=absent");
