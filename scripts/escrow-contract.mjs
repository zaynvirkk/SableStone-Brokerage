import { EscrowComAdapter, SettlementEventInbox } from "../dist/index.js";
import { approval, credentials, draft, now } from "./settlement-fixture.mjs";
const provider = "ESCROW_COM", adapter = new EscrowComAdapter("SANDBOX", approval(provider), credentials(provider));
const instruction = draft(provider, "USD"); const created = await adapter.createInstruction(instruction, now); const replay = await adapter.createInstruction(instruction, now);
if (created !== replay || !created.acknowledged || !adapter.options.brokerRole || !adapter.options.brokerFeeItem || !adapter.options.concealBuyerFromSellerUntilRelease || !adapter.options.concealSellerFromBuyerUntilRelease) throw new Error("escrow broker privacy/fee contract failed");
const inbox = new SettlementEventInbox(), event = { provider, externalEventId: "event-1", providerReference: created.providerReference, eventType: "DISBURSED", occurredAt: now, payloadDigest: "a".repeat(64), signatureVerified: true };
adapter.receiveWebhook(inbox, event); adapter.receiveWebhook(inbox, event);
let rejected = 0;
try { await adapter.createInstruction({ ...instruction, grossAmount: instruction.supplierEntitlement }, now); } catch { rejected += 1; }
try { adapter.receiveWebhook(inbox, { ...event, externalEventId: "bad", signatureVerified: false }); } catch { rejected += 1; }
try { adapter.receiveWebhook(inbox, { ...event, payloadDigest: "b".repeat(64) }); } catch { rejected += 1; }
if (inbox.count() !== 1 || rejected !== 3) throw new Error("Escrow event/allocation failed open");
console.log("ESCROW_OK broker_role=true separate_fee=true privacy=true allocation_exact=true webhook_idempotent=true signature_required=true conflict_rejected=true");
