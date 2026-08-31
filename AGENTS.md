# SableStone Brokerage engineering contract

Build the single production path defined by `PRODUCT.md` and root Plan 66. The
supplier remains seller of record. SableStone must never take title,
possession, purchase consideration, inventory risk, cargo-finance exposure or
buyer credit risk.

Identity release is a server-side choke point. It requires both current
protected-relationship acceptances and an independently acknowledged fee lock.
No prompt, UI role, administrator or provider adapter may bypass it.

Use decimal strings at API boundaries and arbitrary-precision decimal math for
money. Missing evidence is `UNKNOWN`, never zero. External events enter a
durable, unique inbox before processing; writes are idempotency-keyed and
append-only where Plan 66 requires history.

LLMs may extract and draft. Deterministic code owns lifecycle, authorization,
compatibility, price bounds, KYB/risk, agreement versions, fee allocation and
settlement. Unavailable or under-review providers fail their capability closed.

All production live switches default false. Tests use injected fakes only.
Never contact a counterparty, create an account, deploy, move money, trade,
publish or spend without the exact operator gate in Plan 66.

Before changing money, identity, agreements, permissions, provider webhooks or
lifecycle gates, add an exact negative test. Run the focused Plan 66 case,
format/lint/typecheck, broad tests and build before handoff.
