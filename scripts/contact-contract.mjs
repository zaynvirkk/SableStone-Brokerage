import { GlobalSuppressionRegistry, assertContactSendable } from "../dist/index.js";
const now = "2026-08-31T00:00:00Z";
const policy = { version: "fixture-policy-v1", outreachApproved: true, allowedJurisdictions: ["IN"], allowedSources: ["PUBLIC_COMPANY_SITE", "HUNTER"], expiresAt: "2026-12-01T00:00:00Z" };
const contact = { contactId: "c1", organizationId: "o1", email: "Sales@Fixture.Invalid", source: "PUBLIC_COMPANY_SITE", sourceReceiptId: "r1", verification: "VERIFIED", verifiedAt: "2026-08-30T00:00:00Z", lawfulBasisPolicyVersion: "fixture-policy-v1", jurisdiction: "IN" };
const suppression = new GlobalSuppressionRegistry();
assertContactSendable(contact, policy, suppression, now);
let rejected = 0;
for (const changed of [
  { contact: { ...contact, source: "GUESSED" }, policy },
  { contact: { ...contact, verification: "UNVERIFIED", verifiedAt: null }, policy },
  { contact, policy: { ...policy, outreachApproved: false } },
  { contact, policy: { ...policy, expiresAt: "2026-08-01T00:00:00Z" } },
  { contact: { ...contact, jurisdiction: "US" }, policy },
]) { try { assertContactSendable(changed.contact, changed.policy, suppression, now); } catch { rejected += 1; } }
const first = suppression.suppress(" SALES@fixture.invalid ", "UNSUBSCRIBE", "event-1", now);
const duplicate = suppression.suppress("sales@FIXTURE.invalid", "BOUNCE", "event-2", now);
if (first !== duplicate || suppression.entries().length !== 1) throw new Error("suppression not globally idempotent");
try { assertContactSendable(contact, policy, suppression, now); } catch { rejected += 1; }
if (rejected !== 6) throw new Error(`contact negatives lost ${rejected}/6`);
console.log("CONTACT_OK sendable=1 negatives=6 suppression_global=true suppression_idempotent=true");
