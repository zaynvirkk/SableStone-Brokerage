import { renderAgreementTemplate } from "../dist/index.js";
const protectedTemplate =
    "Agreement {{agreement_id}} version {{version}} for {{role}} protects anonymous match {{match_id}} for {{product_family}} at {{commission_currency}} {{commission_per_kg}}/kg.",
  facts = {
    agreement_id: "a-1",
    version: "v1",
    role: "SUPPLIER",
    match_id: "m-1",
    product_family: "RPP",
    commission_currency: "INR",
    commission_per_kg: "4",
  },
  rendered = renderAgreementTemplate(
    "PROTECTED_ACCOUNT_NOTICE",
    protectedTemplate,
    facts,
  );
if (!rendered.includes("anonymous match m-1") || rendered.includes("{{"))
  throw new Error("protected agreement rendering failed");
const invalid = [
  [
    "PROTECTED_ACCOUNT_NOTICE",
    protectedTemplate + " Buyer {{buyer_id}}",
    { ...facts, buyer_id: "secret-buyer" },
  ],
  [
    "PROTECTED_ACCOUNT_NOTICE",
    "{{agreement_id}} {{version}} {{role}} {{unknown}}",
    { agreement_id: "a", version: "v", role: "SUPPLIER", unknown: "x" },
  ],
  [
    "TRANSACTION_CONFIRMATION",
    "{{agreement_id}} {{version}} {{role}} {{supplier_id}} {{buyer_id}}",
    { agreement_id: "a", version: "v", role: "BUYER", supplier_id: "s" },
  ],
  [
    "PROTECTED_ACCOUNT_NOTICE",
    protectedTemplate,
    { ...facts, extra: "forbidden" },
  ],
];
let rejected = 0;
for (const [kind, template, input] of invalid)
  try {
    renderAgreementTemplate(kind, template, input);
  } catch {
    rejected++;
  }
if (rejected !== invalid.length)
  throw new Error("agreement rendering failed open");
const trade = renderAgreementTemplate(
  "TRANSACTION_CONFIRMATION",
  "Trade {{trade_id}} seller {{supplier_id}} buyer {{buyer_id}} {{agreement_id}} {{version}} {{role}}",
  {
    trade_id: "t",
    supplier_id: "s",
    buyer_id: "b",
    agreement_id: "a",
    version: "v",
    role: "BUYER",
  },
);
if (!trade.includes("seller s buyer b"))
  throw new Error("post-release identities unavailable");
console.log(
  `AGREEMENT_AUTOMATION_OK protected_identity_sealed=true trade_identity_released=true rejected=${rejected}`,
);
