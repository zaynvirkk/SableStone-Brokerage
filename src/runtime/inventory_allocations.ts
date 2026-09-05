import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { compareDecimalStrings } from "../domain.js";
import { decimal, subtractDecimal, type DecimalString } from "../money.js";

type AllocationState = "RESERVED" | "COMMITTED" | "CONSUMED" | "RELEASED";

/** Reserve both sides of a trade while holding deterministic row/advisory locks. */
export async function reserveInventory(
  client: PoolClient,
  input: { offerId: string; offerVersion: number; demandId: string; demandVersion: number; tradeId: string; quantityMt: DecimalString },
): Promise<void> {
  if (compareDecimalStrings(decimal(input.quantityMt), decimal("0")) <= 0)
    throw new Error("inventory quantity invalid");
  const lockKeys = [`inventory:offer:${input.offerId}:${input.offerVersion}`, `inventory:demand:${input.demandId}:${input.demandVersion}`].sort();
  for (const key of lockKeys) await client.query("select pg_advisory_xact_lock(hashtext($1))", [key]);
  const offer = (await client.query("select quantity_mt,moq_mt from supplier_offers where id=$1 and version=$2 and verification='VERIFIED' and freshness='CURRENT' and expires_at>now() for update", [input.offerId, input.offerVersion])).rows[0];
  const demand = (await client.query("select quantity_mt from buyer_demands where id=$1 and version=$2 and verification='VERIFIED' and freshness='CURRENT' for update", [input.demandId, input.demandVersion])).rows[0];
  if (!offer || !demand) throw new Error("inventory source unavailable");
  const quantity = decimal(input.quantityMt);
  if (compareDecimalStrings(quantity, decimal(String(offer.moq_mt))) < 0 || compareDecimalStrings(quantity, decimal(String(offer.quantity_mt))) > 0 || compareDecimalStrings(quantity, decimal(String(demand.quantity_mt))) > 0)
    throw new Error("inventory quantity outside offer or demand bounds");
  const existing = (await client.query("select quantity_mt,state from offer_inventory_allocations where offer_id=$1 and offer_version=$2 and trade_id=$3", [input.offerId, input.offerVersion, input.tradeId])).rows[0];
  if (existing) {
    if (compareDecimalStrings(decimal(String(existing.quantity_mt)), quantity) !== 0)
      throw new Error("inventory allocation idempotency conflict");
    const demandExisting = (await client.query("select quantity_mt from demand_inventory_allocations where demand_id=$1 and demand_version=$2 and trade_id=$3", [input.demandId, input.demandVersion, input.tradeId])).rows[0];
    if (!demandExisting || compareDecimalStrings(decimal(String(demandExisting.quantity_mt)), quantity) !== 0)
      throw new Error("inventory allocation sides missing");
    return;
  }
  const offerUsed = (await client.query("select coalesce(sum(quantity_mt),0) quantity from offer_inventory_allocations where offer_id=$1 and offer_version=$2 and state in('RESERVED','COMMITTED','CONSUMED')", [input.offerId, input.offerVersion])).rows[0];
  const demandUsed = (await client.query("select coalesce(sum(quantity_mt),0) quantity from demand_inventory_allocations where demand_id=$1 and demand_version=$2 and state in('RESERVED','COMMITTED','CONSUMED')", [input.demandId, input.demandVersion])).rows[0];
  if (compareDecimalStrings(quantity, subtractDecimal(decimal(String(offer.quantity_mt)), decimal(String(offerUsed.quantity)))) > 0 || compareDecimalStrings(quantity, subtractDecimal(decimal(String(demand.quantity_mt)), decimal(String(demandUsed.quantity)))) > 0)
    throw new Error("inventory already committed");
  await client.query("insert into offer_inventory_allocations(id,offer_id,offer_version,trade_id,quantity_mt,state) values($1,$2,$3,$4,$5,'RESERVED') on conflict(offer_id,offer_version,trade_id) do nothing", [randomUUID(), input.offerId, input.offerVersion, input.tradeId, input.quantityMt]);
  await client.query("insert into demand_inventory_allocations(id,demand_id,demand_version,trade_id,quantity_mt,state) values($1,$2,$3,$4,$5,'RESERVED') on conflict(demand_id,demand_version,trade_id) do nothing", [randomUUID(), input.demandId, input.demandVersion, input.tradeId, input.quantityMt]);
}

export async function transitionInventory(client: PoolClient, tradeId: string, from: AllocationState, to: AllocationState): Promise<number> {
  if (!(["COMMITTED", "CONSUMED", "RELEASED"] as string[]).includes(to)) throw new Error("inventory transition target invalid");
  const timestamp = to === "COMMITTED" ? "committed_at=now()" : to === "CONSUMED" ? "consumed_at=now()" : "released_at=now()";
  const result = await client.query(`update offer_inventory_allocations set state=$3,${timestamp} where trade_id=$1 and state=$2`, [tradeId, from, to]);
  const demand = await client.query(`update demand_inventory_allocations set state=$3,${timestamp} where trade_id=$1 and state=$2`, [tradeId, from, to]);
  if (result.rowCount !== demand.rowCount) throw new Error("inventory allocation sides diverged");
  return result.rowCount ?? 0;
}

export async function releaseInventory(client: PoolClient, tradeId: string): Promise<void> {
  await transitionInventory(client, tradeId, "RESERVED", "RELEASED");
  await transitionInventory(client, tradeId, "COMMITTED", "RELEASED");
}
