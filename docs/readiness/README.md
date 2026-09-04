# SableStone release readiness

The release contains the inert production runtime as well as the deterministic
business kernel: checksum-bound PostgreSQL migrations, durable inbox/outbox,
Temporal workflows, immutable object receipts, cache-only Redis, authenticated
Gmail ingestion/sending, reviewed discovery and enrichment connectors,
document ingestion, approval-backed settlement HTTP adapters, raw signed
webhooks, protected API commands, backup/restore tooling and deployment
manifests. These boundaries have been verified with local fakes only. This is
still a `BUILD_VERIFIED` candidate: it proves software behavior, not legal
status, provider approval, successful deployment, market demand, a trade,
revenue or profitability. Operational capabilities remain unavailable without
a release-bound signed activation containing genuine current receipts.

Launch hardening is part of that software boundary. A domestic provider is not
routable unless current written approval includes
`DELIVERY_CONDITIONAL_SUPPLIER_RELEASE`. Cashfree supplier balances remain
ineligible and Razorpay transfers remain held until receipt-backed buyer
delivery acceptance; a dispute or expired delivery action freezes release.
Provider and bank reconciliation supports multiple entries per trade and must
sum exactly to the immutable fee entitlement and tax-inclusive brokerage
invoice. Valid money events enter an autonomous durable-redrive queue after
repeated infrastructure failures rather than becoming permanently lost.

Counterparty work is represented as durable organization-scoped actions.
Verified contacts are invited through the configured identity provider, and
current principal state is checked on authenticated requests. Agreement,
settlement, funding, dispatch, delivery, dispute and standing-order actions
receive signed deep links and deadline reminders. Operational startup requires
one pinned JWT algorithm, the expected Gmail Pub/Sub service-account identity,
capability-complete configuration, telemetry when enabled, and COMPLIANCE-mode
Object Lock on the evidence bucket.

Recurring execution is part of the verified software boundary. A reconciled
trade loads the mandate's persisted `next_required_at`, uses a Temporal durable
timer for any 1–365 day cadence, and retries unavailable supply only within the
mandate's validity window. The standing authorization—not its source RFQ—owns
the immutable buyer, product/specification, quantity/tolerance, cadence,
currency, all-in-price, supplier-scope and renewal bounds. Every cycle creates
a fresh demand execution instance, reserves (but does not consume) one renewal,
requotes current economics and creates a fresh protected trade and settlement
instruction. Authorization moves `RESERVED → COMMITTED` only when a specific
trade and final-economics snapshot are bound; only a new secured entitlement
can move it to `CONSUMED`, while terminal failure releases it. Enduring
introduction protection is separate from each cycle's transaction terms and
exact settlement acceptances. Quantity tolerance controls execution sizing,
and approved substitution searches qualified suppliers but requires fresh
match-specific protected-account acceptance. An above-ceiling cycle remains explicitly linked to its candidate
and reservation through buyer approval, decline or expiry. The cycle is
consumed only after the provider proves a new secured SableStone entitlement;
decline, failure or expiry releases it. Paid quote work is withheld when the
buyer ceiling is unknown, and pre-quote ranking deducts conservative historical
lane-cost priors. These are deterministic software claims only, not proof that
a buyer has granted a standing authorization or that a provider will execute
one.

The following packets are operator gates and must contain genuine, current
receipts before any later task can proceed:

| Gate | Required genuine evidence | Current state |
|---|---|---|
| SLB-33 legal/tax/privacy/entity | Signed professional memos, entity/GST/bank/e-sign receipts | `BLOCKED_OPERATOR` |
| SLB-34 provider underwriting | Written exact-use-case approval and scoped production credentials | `BLOCKED_OPERATOR` |
| SLB-35 deployment | Deployment, backup/restore, monitoring, secrets and rollback receipts | `BLOCKED_OPERATOR` |
| SLB-36 population | Lawful current-source receipts and measured coverage | `BLOCKED_OPERATOR` |
| SLB-37 bounded live journey | Explicit scope authorization and genuine counterparty/payment receipts | `BLOCKED_OPERATOR` |
| SLB-38 reconciliation | Provider, bank, brokerage invoice and tax-ledger agreement | `BLOCKED_OPERATOR` |
| SLB-39 launch | Explicit operator decision defining enabled scope | `BLOCKED_OPERATOR` |

No public documentation, sandbox response or synthetic fixture may satisfy one
of these rows.

Operational receipt registration must also use the exact capability-specific
kind in [the authority-kind matrix](authority-kind-matrix.md). A current but
unrelated receipt is rejected rather than treated as generic approval.
