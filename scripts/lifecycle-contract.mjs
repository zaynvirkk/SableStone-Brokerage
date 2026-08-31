import { AppendOnlyEventStore, assertTradeTransition } from "../dist/index.js";

const base = {
  supplierAccepted: true, buyerAccepted: true, commissionLocked: true,
  settlementAvailable: true, identityReleased: false,
  supplierIsSeller: true, sablestoneHasCustody: false,
};
assertTradeTransition("MATCHED", "NEGOTIATING", base);
assertTradeTransition("NEGOTIATING", "PROTECTED", base);
assertTradeTransition("PROTECTED", "FEE_LOCKED", base);
assertTradeTransition("FEE_LOCKED", "IDENTITY_RELEASED", base);
assertTradeTransition("IDENTITY_RELEASED", "CONTRACTED", { ...base, identityReleased: true });

let rejected = 0;
for (const action of [
  () => assertTradeTransition("MATCHED", "FUNDED", base),
  () => assertTradeTransition("NEGOTIATING", "PROTECTED", { ...base, buyerAccepted: false }),
  () => assertTradeTransition("PROTECTED", "FEE_LOCKED", { ...base, commissionLocked: false }),
  () => assertTradeTransition("FEE_LOCKED", "IDENTITY_RELEASED", { ...base, settlementAvailable: false }),
  () => assertTradeTransition("FEE_LOCKED", "IDENTITY_RELEASED", { ...base, sablestoneHasCustody: true }),
]) { try { action(); } catch { rejected += 1; } }
if (rejected !== 5) throw new Error(`lifecycle negatives lost ${rejected}/5`);

const store = new AppendOnlyEventStore();
const event = {
  eventId: "event-1", idempotencyKey: "provider:1", aggregateType: "trade",
  aggregateId: "trade-1", eventType: "MATCHED", eventTime: "2026-08-31T00:00:00Z",
  recordedTime: "2026-08-31T00:00:01Z", policyVersion: "v1", payload: { state: "MATCHED" },
};
const first = store.append(event);
const duplicate = store.append(event);
if (first !== duplicate || store.list().length !== 1) throw new Error("idempotency failed");
try { first.payload.state = "FUNDED"; throw new Error("event mutable"); } catch (error) {
  if (error.message === "event mutable") throw error;
}
try { store.append({ ...event, eventId: "event-2" }); throw new Error("conflict accepted"); } catch (error) {
  if (error.message === "conflict accepted") throw error;
}
console.log("LIFECYCLE_OK negatives=5 idempotent=1 append_only=true");
