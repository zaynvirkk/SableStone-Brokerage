import type { Pool } from "pg";
import type { AuthorityKind } from "../authority.js";

/** A receipt authorizes only the exact capability named by its kind. Merely
 * being current is insufficient: this prevents a marketing, legal, or other
 * unrelated receipt from opening a production connector. */
export async function assertCurrentAuthorityReceipt(
  pool: Pick<Pool, "query">,
  receiptId: string,
  expectedKind: AuthorityKind,
): Promise<void> {
  if (typeof receiptId !== "string" || !receiptId.trim())
    throw new Error("authority receipt id missing");
  const result = await pool.query(
    "select 1 from authority_receipts where receipt_id=$1 and authority_kind=$2 and retrieved_at<=now() and effective_at<=now() and expires_at>now()",
    [receiptId, expectedKind],
  );
  if (!result.rowCount)
    throw new Error(`current ${expectedKind} authority receipt unavailable`);
}
