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

export interface AuthorityUseGuard {
  assertCurrent(): Promise<void>;
}

export class DatabaseAuthorityUseGuard implements AuthorityUseGuard {
  constructor(
    readonly pool: Pick<Pool, "query">,
    readonly receiptId: string,
    readonly expectedKind: AuthorityKind,
  ) {}

  assertCurrent(): Promise<void> {
    return assertCurrentAuthorityReceipt(
      this.pool,
      this.receiptId,
      this.expectedKind,
    );
  }
}

/** Rechecks the exact provider approval selected at startup. A newer approval
 * cannot silently replace it, and expiry of either row closes the rail. */
export class DatabaseProviderApprovalUseGuard implements AuthorityUseGuard {
  constructor(
    readonly pool: Pick<Pool, "query">,
    readonly approvalId: string,
    readonly provider: string,
    readonly writtenApprovalReceiptId: string,
  ) {}

  async assertCurrent(): Promise<void> {
    const result = await this.pool.query(
      "select 1 from provider_approvals pa join authority_receipts ar on ar.receipt_id=pa.written_approval_receipt_id where pa.id=$1 and pa.provider=$2 and pa.environment='PRODUCTION' and pa.written_approval_receipt_id=$3 and pa.state='APPROVED' and pa.valid_from<=now() and pa.valid_until>now() and ar.authority_kind='PROVIDER_WRITTEN_APPROVAL' and ar.retrieved_at<=now() and ar.effective_at<=now() and ar.expires_at>now()",
      [this.approvalId, this.provider, this.writtenApprovalReceiptId],
    );
    if (!result.rowCount)
      throw new Error(
        `current provider approval unavailable:${this.provider}:${this.approvalId}`,
      );
  }
}
