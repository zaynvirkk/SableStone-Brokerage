import {
  assertCurrentAuthorityReceipt,
  DatabaseAuthorityUseGuard,
  DatabaseProviderApprovalUseGuard,
  DatabaseActivationUseGuard,
} from "../dist/index.js";

const records = new Map([
  ["current", { kind: "KYB_PROVIDER_APPROVAL", current: true }],
  ["marketing", { kind: "MARKETING_PAGE", current: true }],
  ["expired", { kind: "KYB_PROVIDER_APPROVAL", current: false }],
]);
const pool = {
  async query(sql, values) {
    if (
      !sql.includes("authority_kind=$2") ||
      !sql.includes("retrieved_at<=now()") ||
      !sql.includes("effective_at<=now()") ||
      !sql.includes("expires_at>now()")
    )
      throw new Error("authority query is not exact and current");
    const record = records.get(values[0]);
    return {
      rowCount: record?.current && record.kind === values[1] ? 1 : 0,
      rows: [],
    };
  },
};

await assertCurrentAuthorityReceipt(pool, "current", "KYB_PROVIDER_APPROVAL");
let rejected = 0;
for (const [id, kind] of [
  ["marketing", "KYB_PROVIDER_APPROVAL"],
  ["expired", "KYB_PROVIDER_APPROVAL"],
  ["current", "DOCUMENT_VERIFICATION_APPROVAL"],
]) {
  try {
    await assertCurrentAuthorityReceipt(pool, id, kind);
  } catch {
    rejected++;
  }
}
if (rejected !== 3) throw new Error("authority type confusion survived");
let current = true,
  perUseChecks = 0;
const mutablePool = {
    async query(sql, values) {
      perUseChecks++;
      if (sql.includes("provider_approvals")) {
        const matches =
          current &&
          values[0] === "approval-1" &&
          values[1] === "ESCROW_COM" &&
          values[2] === "written-1";
        return { rowCount: matches ? 1 : 0, rows: [] };
      }
      const matches =
        current &&
        values[0] === "current" &&
        values[1] === "KYB_PROVIDER_APPROVAL";
      return { rowCount: matches ? 1 : 0, rows: [] };
    },
  },
  receiptGuard = new DatabaseAuthorityUseGuard(
    mutablePool,
    "current",
    "KYB_PROVIDER_APPROVAL",
  ),
  providerGuard = new DatabaseProviderApprovalUseGuard(
    mutablePool,
    "approval-1",
    "ESCROW_COM",
    "written-1",
  );
await receiptGuard.assertCurrent();
await providerGuard.assertCurrent();
current = false;
let postStartupBlocked = 0;
for (const guard of [receiptGuard, providerGuard]) {
  try {
    await guard.assertCurrent();
  } catch {
    postStartupBlocked++;
  }
}
if (postStartupBlocked !== 2 || perUseChecks !== 4)
  throw new Error("per-use authority guard cached startup state");
let activationCurrent = true,
  activationChecks = 0;
const activationPool = {
    async query(sql, values) {
      activationChecks++;
      if (
        !sql.includes("activation_receipt_bindings") ||
        !sql.includes("a.authority_kind=$5") ||
        values[2] !== "release-1"
      )
        throw new Error("activation binding query incomplete");
      return { rowCount: activationCurrent ? 1 : 0, rows: [] };
    },
  },
  activation = {
    releaseDigest: "release-1",
    operatorAuthorizationReceiptId: "operator-1",
    entityReceiptId: "entity-1",
    legalReceiptId: "legal-1",
    taxReceiptId: "tax-1",
    privacyReceiptId: "privacy-1",
    deploymentReceiptId: "deployment-1",
    authorizedBy: "operator",
    authorizedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    capabilities: ["OUTREACH", "SETTLEMENT", "TRADING"],
  },
  activationGuard = new DatabaseActivationUseGuard(
    activationPool,
    activation,
    "release-1",
    "OUTREACH",
  );
await activationGuard.assertCurrent();
activationCurrent = false;
try {
  await activationGuard.assertCurrent();
  throw new Error("expired activation receipts survived per-use check");
} catch (error) {
  if (!String(error).includes("not current or release-bound")) throw error;
}
if (activationChecks !== 7)
  throw new Error("activation authority was cached or incompletely checked");
console.log(
  "AUTHORITY_RECEIPT_KIND_OK exact_kind=required marketing=blocked expired=blocked cross_capability=blocked retrieved_before_use=required per_use=required expired_after_start=blocked provider_approval_after_start=blocked activation_after_start=blocked authority_cache=none",
);
