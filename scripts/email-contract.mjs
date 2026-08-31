import { DurableEmailInbox, EmailTransport, GmailHistoryCursor, GlobalSuppressionRegistry, applyBounce } from "../dist/index.js";
const inbox = new DurableEmailInbox(), cursor = new GmailHistoryCursor();
const event = { externalEventId: "gmail:event-1", type: "MESSAGE_RECEIVED", threadId: "thread-1", messageId: "message-1", sender: "supplier@fixture.invalid", recipient: "broker@fixture.invalid", occurredAt: "2026-08-31T00:00:01Z", payloadObjectKey: "email/event-1" };
const envelope = { externalEventId: "push-1", emailAddress: "broker@fixture.invalid", historyId: 5n, publishedAt: "2026-08-31T00:00:02Z", authenticated: true, audience: "fixture-audience" };
const fetch = (fromExclusive, toInclusive) => ({ fromExclusive, toInclusive, events: [event, event] });
cursor.acceptPush(envelope, "fixture-audience", fetch, inbox);
cursor.acceptPush(envelope, "fixture-audience", fetch, inbox);
if (inbox.count() !== 1 || cursor.current() !== 5n) throw new Error("email replay/idempotency failed");
let rejected = 0;
for (const changed of [{ ...envelope, authenticated: false }, { ...envelope, audience: "wrong", historyId: 6n }]) {
  try { cursor.acceptPush(changed, "fixture-audience", fetch, inbox); } catch { rejected += 1; }
}
try { new EmailTransport("PRODUCTION", false); } catch { rejected += 1; }
const transport = new EmailTransport("SANDBOX", false);
const outbound = { idempotencyKey: "send-1", threadId: null, recipient: "supplier@fixture.invalid", subject: "Fixture request", bodyObjectKey: "outbound/send-1" };
if (transport.send(outbound) !== transport.send(outbound) || transport.count() !== 1) throw new Error("send not idempotent");
const suppressions = new GlobalSuppressionRegistry();
const contact = { contactId: "c", organizationId: "o", email: "supplier@fixture.invalid", source: "INBOUND", sourceReceiptId: "r", verification: "VERIFIED", verifiedAt: "2026-08-30T00:00:00Z", lawfulBasisPolicyVersion: "p", jurisdiction: "IN" };
applyBounce({ ...event, externalEventId: "bounce-1", type: "BOUNCE", recipient: contact.email }, contact, suppressions);
if (!suppressions.isSuppressed(contact.email) || rejected !== 3) throw new Error("email fail closed cases lost");
console.log("EMAIL_OK authenticated_push=true history_recovered=true inbox_unique=true send_idempotent=true bounce_suppressed=true negatives=3");
