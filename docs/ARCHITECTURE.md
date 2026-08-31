# Architecture

The production topology is Next.js/TypeScript at the edge, a strict
TypeScript service layer, PostgreSQL as the source of truth, Temporal for
durable orchestration, Redis only for cache/rate limits and encrypted
S3-compatible storage for documents.

PostgreSQL transactions own lifecycle changes, inbox deduplication, outbox
creation and ledger writes. Temporal may retry and recover work but cannot
invent state. Redis loss cannot lose or approve a trade. Provider adapters are
injected capabilities and begin `UNAVAILABLE`.

The checked-in compose file is a local fake/development topology. Its values
are not production credentials and it performs no external action.
