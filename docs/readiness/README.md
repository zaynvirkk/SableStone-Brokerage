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

Recurring execution is part of the verified software boundary. A due standing
order reserves (but does not consume) one authorized cycle, creates a fresh
match and current economic quotes, enforces the buyer's quantity, cadence,
currency and all-in-price bounds, then creates a new protected trade and a new
settlement instruction. The cycle is consumed only after the provider proves a
fresh secured SableStone entitlement; failure or expiry releases the
reservation. Paid quote work is withheld when the buyer ceiling is unknown,
and pre-quote ranking deducts conservative historical lane-cost priors. These
are deterministic software claims only, not proof that a buyer has granted a
standing authorization or that a provider will execute one.

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
