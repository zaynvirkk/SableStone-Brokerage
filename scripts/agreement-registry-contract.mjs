import { agreementApprovalBindingSha256 } from "../dist/index.js";

const base = {
  agreementId: "11111111-1111-4111-8111-111111111111",
  version: "counsel-v1",
  kind: "PROTECTED_ACCOUNT_NOTICE",
  bodySha256: "a".repeat(64),
  resourceType: "MATCH",
  resourceId: "22222222-2222-4222-8222-222222222222",
  expectedOrganizationId: "33333333-3333-4333-8333-333333333333",
  role: "SUPPLIER",
  effectiveAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2026-12-01T00:00:00.000Z",
};
const digest = agreementApprovalBindingSha256(base);
if (!/^[0-9a-f]{64}$/.test(digest))
  throw new Error("agreement approval digest invalid");
for (const changed of [
  { ...base, resourceId: "44444444-4444-4444-8444-444444444444" },
  { ...base, expectedOrganizationId: "55555555-5555-4555-8555-555555555555" },
  { ...base, bodySha256: "b".repeat(64) },
  { ...base, version: "counsel-v2" },
])
  if (agreementApprovalBindingSha256(changed) === digest)
    throw new Error("agreement approval digest omitted exact binding field");
const invalid = [
  { ...base, kind: "PROTECTED_ACCOUNT_NOTICE", role: "BUYER" },
  { ...base, kind: "SUPPLIER_MASTER_BROKERAGE", resourceType: "MATCH" },
  { ...base, kind: "TRANSACTION_CONFIRMATION", resourceType: "ORG_MASTER" },
  { ...base, bodySha256: "not-a-digest" },
  { ...base, expiresAt: base.effectiveAt },
];
let rejected = 0;
for (const value of invalid)
  try {
    agreementApprovalBindingSha256(value);
  } catch {
    rejected += 1;
  }
if (rejected !== invalid.length)
  throw new Error("agreement scope validation failed open");
console.log(
  `AGREEMENT_REGISTRY_OK digest=${digest} changed=4 rejected=${rejected}`,
);
