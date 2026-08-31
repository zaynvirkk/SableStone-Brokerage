import {
  CashfreeEasySplitAdapter,
  EscrowComAdapter,
  FeeLockRegistry,
  IndianBankEscrowAdapter,
  ProtectedIdentityVault,
  decimal,
  releaseIdentityAfterFeeLock,
  routeSettlement,
} from "../dist/index.js";
import { approval, credentials, draft, now } from "./settlement-fixture.mjs";
const cash = new CashfreeEasySplitAdapter(
  "SANDBOX",
  approval("CASHFREE_EASY_SPLIT"),
  credentials("CASHFREE_EASY_SPLIT"),
  {
    vendorId: "v",
    organizationId: "supplier-1",
    kycState: "ACTIVE",
    bankVerified: true,
  },
);
const bank = new IndianBankEscrowAdapter(
  "SANDBOX",
  approval("INDIAN_BANK_ESCROW"),
  credentials("INDIAN_BANK_ESCROW"),
);
const escrow = new EscrowComAdapter(
  "SANDBOX",
  approval("ESCROW_COM"),
  credentials("ESCROW_COM"),
);
const routed = routeSettlement(
  {
    geography: "DOMESTIC_INDIA",
    relationshipMaturity: "NEW",
    hasDocumentaryLc: false,
  },
  [bank, cash, escrow],
  ["BROKER_FEE_SPLIT"],
  now,
);
if (routed.adapter.provider !== "CASHFREE_EASY_SPLIT")
  throw new Error("domestic route preference failed");
const input = draft("CASHFREE_EASY_SPLIT"),
  created = await routed.adapter.createInstruction(input, now),
  digest = "a".repeat(64);
const lockInput = {
  feeLockId: "lock-1",
  tradeId: "trade-1",
  relationshipId: "rel-1",
  instruction: input,
  providerSnapshot: routed.snapshot,
  providerReference: created.providerReference,
  providerAcknowledged: created.acknowledged,
  fundsSecured: true,
  sablestoneBeneficiaryVerified: true,
  entitlementSecurityEvidenceDigest: "f".repeat(64),
  instructionDigest: digest,
  supplierAcceptedInstructionDigest: digest,
  buyerAcceptedInstructionDigest: digest,
  createdAt: now,
};
const locks = new FeeLockRegistry(),
  lock = locks.lock(lockInput),
  replay = locks.lock(lockInput);
if (lock !== replay) throw new Error("fee lock not idempotent");
const vault = new ProtectedIdentityVault(),
  sealed = (organizationId) => ({
    organizationId,
    legalNameCiphertext: "enc:l",
    addressCiphertext: "enc:a",
    contactCiphertext: "enc:c",
    taxIdCiphertext: "enc:t",
    bankDetailsCiphertext: "enc:b",
    keyVersion: "kms-v1",
  });
vault.seal(sealed("supplier-1"));
vault.seal(sealed("buyer-1"));
const relationship = {
  relationshipId: "rel-1",
  supplierId: "supplier-1",
  buyerId: "buyer-1",
  introducedAt: "2026-08-30T00:00:00Z",
  protectedUntil: "2028-08-30T00:00:00Z",
  commodityScope: ["RPP_NATURAL_LIGHT_INJECTION"],
  affiliateScope: "fixture",
  qualifyingPurchaseDefinition: "fixture",
  commissionType: "PER_KG",
  commissionRate: decimal("4"),
  currency: "INR",
  supplierAcceptanceId: "sa",
  supplierAcceptanceSha256: "b".repeat(64),
  buyerAcceptanceId: "ba",
  buyerAcceptanceSha256: "c".repeat(64),
  requiredSettlementCapabilities: ["BROKER_FEE_SPLIT"],
};
const auth = {
  supplierAcceptanceCurrent: true,
  buyerAcceptanceCurrent: true,
  authorizationDigest: "d".repeat(64),
  authorizedAt: now,
};
const released = releaseIdentityAfterFeeLock(vault, relationship, lock, auth);
if (!released.feeLockId) throw new Error("release not lock bound");
let rejected = 0;
const mutations = [
  { ...lockInput, feeLockId: "m1", providerAcknowledged: false },
  { ...lockInput, feeLockId: "m0", fundsSecured: false },
  {
    ...lockInput,
    feeLockId: "m2",
    supplierAcceptedInstructionDigest: "e".repeat(64),
  },
  {
    ...lockInput,
    feeLockId: "m3",
    buyerAcceptedInstructionDigest: "e".repeat(64),
  },
  {
    ...lockInput,
    feeLockId: "m4",
    providerSnapshot: { ...routed.snapshot, state: "UNDER_REVIEW" },
  },
  {
    ...lockInput,
    feeLockId: "m5",
    instruction: {
      ...input,
      sablestoneEntitlement: decimal("0"),
      supplierEntitlement: input.grossAmount,
    },
  },
];
for (const mutation of mutations)
  try {
    locks.lock(mutation);
  } catch {
    rejected++;
  }
try {
  routeSettlement(
    {
      geography: "DOMESTIC_INDIA",
      relationshipMaturity: "NEW",
      hasDocumentaryLc: false,
    },
    [],
    ["BROKER_FEE_SPLIT"],
    now,
  );
} catch {
  rejected++;
}
const bankDraft = await bank.createInstruction(
  draft("INDIAN_BANK_ESCROW"),
  now,
);
try {
  locks.lock({
    ...lockInput,
    feeLockId: "m6",
    instruction: draft("INDIAN_BANK_ESCROW"),
    providerSnapshot: bank.capability(["BROKER_FEE_SPLIT"], now),
    providerReference: bankDraft.providerReference,
    providerAcknowledged: bankDraft.acknowledged,
  });
} catch {
  rejected++;
}
if (rejected !== 8) throw new Error(`router mutations lost ${rejected}/8`);
console.log(
  "ROUTER_OK domestic_route=cashfree fee_lock=true identity_release=after_lock mutations=8 instruction_created=not_locked no_rail=reject bank_draft=not_locked replay=idempotent",
);
