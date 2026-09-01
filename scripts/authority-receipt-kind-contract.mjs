import { assertCurrentAuthorityReceipt } from "../dist/index.js";

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
      rowCount:
        record?.current && record.kind === values[1] ? 1 : 0,
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
console.log(
  "AUTHORITY_RECEIPT_KIND_OK exact_kind=required marketing=blocked expired=blocked cross_capability=blocked retrieved_before_use=required",
);
