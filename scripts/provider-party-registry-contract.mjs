import { canonicalProviderPartyPayload } from "../dist/index.js";

const valid = [
  ["ESCROW_COM", "BUYER", { customer: "buyer@example.test" }],
  ["ESCROW_COM", "SUPPLIER", { customer: "supplier@example.test" }],
  ["ESCROW_COM", "SABLESTONE", { customer: "broker@example.test" }],
  [
    "CASHFREE_EASY_SPLIT",
    "BUYER",
    {
      customer_id: "buyer-1",
      customer_name: "Buyer One",
      customer_email: "buyer@example.test",
      customer_phone: "+919999999999",
    },
  ],
  ["CASHFREE_EASY_SPLIT", "SUPPLIER", { vendor_id: "vendor-1" }],
  ["CASHFREE_EASY_SPLIT", "SABLESTONE", { merchant_id: "merchant-1" }],
  ["RAZORPAY_ROUTE", "BUYER", { customer_id: "buyer-1" }],
  ["RAZORPAY_ROUTE", "SUPPLIER", { linked_account_id: "acc_supplier" }],
  ["RAZORPAY_ROUTE", "SABLESTONE", { merchant_account_id: "merchant-1" }],
  ["INDIAN_BANK_ESCROW", "BUYER", { payer_id: "payer-1" }],
  [
    "INDIAN_BANK_ESCROW",
    "SUPPLIER",
    { beneficiary_id: "supplier-beneficiary" },
  ],
  [
    "INDIAN_BANK_ESCROW",
    "SABLESTONE",
    { beneficiary_id: "broker-beneficiary" },
  ],
  ["LC_PROCEEDS", "BUYER", { applicant_id: "applicant-1" }],
  ["LC_PROCEEDS", "SUPPLIER", { credit_beneficiary_id: "beneficiary-1" }],
  ["LC_PROCEEDS", "SABLESTONE", { assignee_id: "assignee-1" }],
];
for (const [provider, role, payload] of valid) {
  const first = canonicalProviderPartyPayload(provider, role, payload),
    second = canonicalProviderPartyPayload(
      provider,
      role,
      Object.fromEntries(Object.entries(payload).reverse()),
    );
  if (first !== second)
    throw new Error("provider party canonicalization unstable");
}
const invalid = [
  ["ESCROW_COM", "BUYER", {}],
  ["ESCROW_COM", "BUYER", { customer: "buyer", internal_uuid: "forbidden" }],
  [
    "CASHFREE_EASY_SPLIT",
    "BUYER",
    {
      customer_id: "x",
      customer_name: "x",
      customer_email: "not-email",
      customer_phone: "99999999",
    },
  ],
  [
    "CASHFREE_EASY_SPLIT",
    "BUYER",
    {
      customer_id: "x",
      customer_name: "x",
      customer_email: "a@b.test",
      customer_phone: "abc",
    },
  ],
  ["RAZORPAY_ROUTE", "SUPPLIER", { linked_account_id: "bad\nheader" }],
  ["UNKNOWN", "BUYER", { customer: "x" }],
];
let rejected = 0;
for (const [provider, role, payload] of invalid) {
  try {
    canonicalProviderPartyPayload(provider, role, payload);
  } catch {
    rejected += 1;
  }
}
if (rejected !== invalid.length)
  throw new Error("provider party schema failed open");
console.log(
  `PROVIDER_PARTY_REGISTRY_OK valid=${valid.length} rejected=${rejected} canonical=true`,
);
