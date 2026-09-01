# SLB-34 provider underwriting questionnaire

Status: `BLOCKED_OPERATOR`.

For each proposed rail, obtain written approval that names the legal entity,
polymer brokerage use case, merchandise, buyer/supplier/broker roles, money
flow, SableStone allocation, currencies, geography, limits, refunds, disputes,
reversals, KYC/KYB obligations and webhook/authentication mechanism.

The approval must explicitly confirm that the provider can pay supplier
entitlement and SableStone brokerage separately without SableStone taking
custody of buyer purchase funds. Capture production credential scope and
expiry independently. `AVAILABLE` is forbidden until both approval and current
credentials pass. Marketing pages, docs, sales calls and sandbox access are not
approval.

Each production API, OAuth or webhook secret must also be registered through
the immutable `production_credential_bindings` registry. Registration stores
only a SHA-256 fingerprint of the supplied credential tuple and requires a
current `PRODUCTION_CREDENTIAL_VERIFICATION` receipt. Rotation creates a new
binding; compromise or withdrawal creates an append-only revocation backed by
`PRODUCTION_CREDENTIAL_REVOCATION`. Configuration flags and timestamps cannot
self-assert that a credential is valid.
