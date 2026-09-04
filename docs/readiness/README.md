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

Recurring execution is part of the verified software boundary. A reconciled
trade loads the mandate's persisted `next_required_at`, uses a Temporal durable
timer for any 1–365 day cadence, and retries unavailable supply only within the
mandate's validity window. The standing authorization—not its source RFQ—owns
the immutable buyer, product/specification, quantity/tolerance, cadence,
currency, all-in-price, supplier-scope and renewal bounds. Every cycle creates
a fresh demand execution instance, reserves (but does not consume) one renewal,
requotes current economics and creates a fresh protected trade and settlement
instruction. An above-ceiling cycle remains explicitly linked to its candidate
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
