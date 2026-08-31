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

## Deployment boundary

Do not copy `.example` files into source control with values. Production
secrets must be mounted by the deployment environment. Run the migration
container first, verify backup/restore and readiness, then start API/web while
all operational capabilities remain absent. Enabling a capability requires a
new signed activation artifact bound to the exact release digest.
