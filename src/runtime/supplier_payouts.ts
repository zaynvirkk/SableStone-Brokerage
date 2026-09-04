import type { Pool } from "pg";
import type { ProductionSettlementHttpAdapter } from "../connectors/settlement_http.js";

export class SupplierPayoutReleaseDispatcher {
  readonly adapters: ReadonlyMap<string, ProductionSettlementHttpAdapter>;
  constructor(
    readonly pool: Pool,
    adapters: readonly ProductionSettlementHttpAdapter[],
  ) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.provider, adapter]));
  }
  async dispatchBatch(limit = 25): Promise<number> {
    if (limit < 1 || limit > 100) throw new Error("supplier payout batch invalid");
    const rows = (
      await this.pool.query(
        "with claimed as(select p.instruction_id from supplier_payout_controls p join trades t on t.id=p.trade_id join delivery_acceptances d on d.trade_id=t.id where p.state in('HELD','RELEASE_PENDING') and t.state in('ACCEPTED','SETTLED','RECURRING') and not exists(select 1 from counterparty_dispute_requests x where x.trade_id=t.id and x.state in('OPENED','PROVIDER_SUBMITTED','FROZEN')) order by d.accepted_at for update of p skip locked limit $1) update supplier_payout_controls p set state='RELEASE_PENDING',updated_at=now() from claimed where p.instruction_id=claimed.instruction_id returning p.*",
        [limit],
      )
    ).rows;
    let released = 0;
    for (const row of rows) {
      const adapter = this.adapters.get(String(row.provider));
      try {
        if (!adapter || !row.provider_payout_reference)
          throw new Error("approved supplier payout adapter unavailable");
        const receipt = await adapter.releaseSupplierPayout(
          String(row.provider_payout_reference),
          new Date().toISOString(),
        );
        const result = await this.pool.query(
          "update supplier_payout_controls set state='RELEASED',release_evidence_sha256=$2,released_at=now(),updated_at=now(),last_error_code=null where instruction_id=$1 and state='RELEASE_PENDING'",
          [row.instruction_id, receipt.receiptSha256],
        );
        released += result.rowCount ?? 0;
      } catch (error) {
        await this.pool.query(
          "update supplier_payout_controls set state='HELD',last_error_code=$2,updated_at=now() where instruction_id=$1 and state='RELEASE_PENDING'",
          [row.instruction_id, (error as Error).name.slice(0, 100)],
        );
      }
    }
    return released;
  }
}
