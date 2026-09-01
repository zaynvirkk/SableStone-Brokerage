# Production runtime

The runtime is production-capable but intentionally inert without a signed,
short-lived activation artifact. A `DEPLOY`-only activation can run migrations
and health checks. Discovery, outreach, settlement and trading require the full
entity, legal, tax, privacy and successful-deployment receipt set in addition
to provider-specific approval and credentials.

## Processes

- `npm run migrate:production` applies checksum-bound PostgreSQL migrations
  under one advisory lock.
- `npm run start:production` starts the JWT-protected API and receipt-backed
  webhooks.
- `npm run worker:production` starts Temporal workflows and the inbox/outbox
  supervisor from the same activated runtime. Settlement activities receive
  only adapters backed by a current written production approval and a recently
  verified credential reference.
- The Next.js `/api/readiness` route holds the backend service credential on
  the server and never exposes it to the browser.

PostgreSQL owns records, the external-event inbox and transactional outbox.
Object storage owns immutable raw bytes. Temporal owns long-running timers and
retries. Redis is limited to caches, rate limits and recoverable locks; no
economic or lifecycle truth is stored only in Redis.

Settlement and Gmail webhook routes preserve the exact raw request bytes before
processing. Settlement signatures are checked over those bytes, and Gmail push
identity is verified as a Google OIDC token for the configured audience. A
parsed or reserialized body cannot substitute for the signed input.

Instruction creation is not a fee lock. `FEE_LOCKED` requires an immutable
`entitlement_security_events` receipt proving secured funds, exact
gross/currency, the supplier allocation and SableStone's beneficiary position.
Escrow.com notifications are confirmed by fetching the transaction. Cashfree
and Razorpay verify captured-payment webhooks and then create the approved
supplier-only split or transfer; SableStone retains its merchant commission.
Provider configuration must supply the exact reviewed event paths and the
post-capture endpoint templates approved for that production account.

## Deployment boundary

Do not copy `.example` files into source control with values. Production
secrets must be mounted by the deployment environment. Run the migration
container first, verify backup/restore and readiness, then start API/web while
all operational capabilities remain absent. Enabling a capability requires a
new signed activation artifact bound to the exact release digest.
Production connector configuration cannot self-assert credential validity.
Before constructing Gmail, settlement, bank-webhook, enrichment, commercial
extraction, document, KYB or economic-quote connectors, startup hashes the
exact supplied credential tuple and requires a current matching immutable
`production_credential_bindings` row backed by a
`PRODUCTION_CREDENTIAL_VERIFICATION` receipt. Revoked, expired, rotated,
wrong-provider or wrong-capability material fails closed; raw credentials are
never stored in the registry.
