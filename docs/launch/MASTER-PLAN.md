# SableStone: complete launch and autonomous-operations plan

Written 5 September 2026. Baseline audited commit: `15cf22272c1189b2b9a7fd881e9649b3b970cc1e`.

**Current verdict: NO-GO. Plan status: OPEN. This document is a specification, not evidence that its tasks are finished.**

This is the launch-remediation addendum to [Plan 66](../../../../plans/66_LANE_sablestone_autonomous_polymer_brokerage.md), not a new business architecture or an MVP roadmap. Preserve the existing product, eight polymer families, supplier-as-seller structure, durable workflows and protected fee model. Complete and verify the whole software chain before contacting a live buyer or supplier. External onboarding and professional work may proceed alongside engineering when separately authorized.

The [machine-readable task specification](implementation-tasks.json) contains 35 engineering work packages, dependencies, production paths and 105 exact acceptance cases. They are registered as `SH-00`–`SH-34` in the existing portfolio manifest, `plans/completion/66.json`. The corresponding local test modules and contract probes are now checked in; a passing local case still proves only the bounded software behavior it exercises, never a live provider, bank, deployment or commercial outcome. `SH-00` remains the connected-service integration harness and is skipped unless explicit disposable PostgreSQL/Temporal/Redis/object-storage endpoints are supplied. External deliverables are `EX-01`–`EX-12`; the existing `SLB-33`–`SLB-40` remain the authoritative live gates. One agent can implement and verify all automatic work. GitHub Actions stays removed.

## 1. What we are trying to achieve

The operational objective is a company that, within an explicitly approved scope, repeatedly:

```
discovers and qualifies counterparties
  -> obtains genuine stock and demand
  -> matches, prices and negotiates within authority
  -> obtains exact protected-account and transaction acceptances
  -> secures independent commission entitlement and required funding
  -> releases permitted identities
  -> coordinates supplier-owned shipping and external inspection
  -> obtains contractual acceptance or external dispute resolution
  -> causes approved supplier/broker disbursements
  -> reconciles provider, bank, invoice and tax records
  -> rematches a newly authorized recurring order
```

Normal operations must not require the founder to source leads, enter CRM records, read an inbox, negotiate, copy provider IDs, repair SQL, restart workflows, approve ordinary orders, chase accounts payable, track a truck or reconcile a spreadsheet.

There are two limits that cannot be removed by software:

1. **Profit is an outcome, not a software guarantee.** Buyers may not buy, suppliers may not perform, markets may have no executable spread, and operating costs may exceed commissions. The machine must measure this and stop uneconomic acquisition without inventing revenue.
2. **Literal zero supervision forever is not a credible business promise.** Directors retain applicable duties; banks may require signatures or renewed KYC; disputes, security incidents and law changes may require professionals. To minimize founder involvement, appoint authorized external services with real mandates, service levels, spending limits and backups. If nobody can lawfully act, affected new business pauses. The system must not pretend the obligation disappeared.

The target is therefore **founder-independent routine operation and automatic recovery, with contracted external handling of unavoidable exceptions**, not an unaccountable company or guaranteed passive income. The external staffing/service choices below require explicit approval; this plan does not silently hire anyone.

## 2. Business constitution and permitted scope

### Financial and commercial invariants

- Supplier owns the goods, remains seller of record, issues the material invoice and bears its contractual quality/performance duties.
- Buyer purchases from supplier. Independent approved bank/escrow/payment arrangements hold purchase funds. SableStone's ordinary account receives its own service entitlement, not the gross cargo price.
- SableStone never purchases/resells resin, warehouses cargo, transports it, clears customs, lends, prepays suppliers, guarantees performance or takes inventory/cargo-credit risk.
- Broker service invoices remain mandatory where applicable; embedding a commission in settlement does not eliminate invoicing or tax obligations.
- Contracts and tax policy must identify the broker-fee debtor, actual payer and service-invoice recipient. Do not assume that retaining a merchant balance determines who legally purchased the brokerage service or the supplier's material-invoice value.
- Contract rights, reserved stock, order-created, payment-authorized, payment-captured, funds-secured, allocation-verified, release-authorized and cash-received are separate facts.
- Final economics, quantity, commission, tax policy, beneficiary mappings and settlement terms must remain bound to the same immutable accepted snapshot. Any permitted material change requires new current authority/acceptance.
- Account protection is not permission to place another order. Every repeat purchase needs a current buyer mandate or explicit fresh approval, current supply and a new financial entitlement.
- No overdue document, stale data, unknown tax, unsupported currency or unapproved allocation is silently interpreted as zero cost or permission.
- Spending is explicitly authorized and lifetime-capped. No principal-trade escape hatch is part of this project.

### Identity and funding must be legally and technically compatible

Both counterparties accept protected relationship terms before their identities are exposed to each other. Banks, payment providers, counsel and regulators may receive identities as legally required; do not conceal information from them. Anonymous documents must not leak names through PDFs, logos, metadata, bank details, URLs, OCR layers or sufficiently identifying descriptions.

The provider-hosted onboarding/funding process must actually preserve the required counterparty anonymity. Buyers must also have legally adequate pre-funding terms describing the anonymous purchase, refund rights, deadlines and the broker role. A post-funding material contract alone may be insufficient: counsel must approve the complete sequence.

If a provider requires counterparty-to-counterparty identity disclosure before it can secure the required entitlement, that route does not fit the current constitution. Do not solve this by weakening the identity gate or mislabeling an order as secured.

An LC proceeds assignment concerns future proceeds; it must not be called secured cash merely because a bank acknowledged the assignment. The current strict funded-before-disclosure policy excludes a route that cannot satisfy it. A different legal security policy would be a separately approved constitutional change, not an automatic optimization.

### Product and market scope

All eight existing families remain in the finished software: recycled PP natural/light and coloured/black injection; recycled HDPE natural and coloured/black blow/injection; recycled LDPE/LLDPE film; and prime/non-prime PP, HDPE and LLDPE. Prime, off-grade, PCR and PIR are not interchangeable facts. Food contact, medical use, hazardous contamination and waste-versus-product classification need affirmative scope-specific evidence; never infer suitability from polymer name or a recycling registration.

Final global scope requires at least one proved domestic and one proved international route. A provider that is genuinely unsupported stays unavailable; the system need not pretend every optional adapter can execute every transaction. If only domestic scope is approved, label it domestic-only and obtain an explicit scope decision rather than calling the full global business complete.

## 3. Baseline: preserve what exists, close demonstrated gaps

The audit applied all 61 forward migration files to disposable PostgreSQL, analyzed 441 static statements, checked 413 parameter arrays and reproduced runtime failures. Compilation and the signed local report still passed. That establishes why isolated green tests are not sufficient.

The [archived baseline audit and reproduction details](evidence/AUDIT-2026-09-05.md) are preserved with this plan. Planning changes do not repair the recorded failures or produce a new build attestation; current-source verification must be regenerated after implementation.

| Audit finding | Required task closure |
|---|---|
| Missing `trades.created_at` breaks economics/priority | SH-02, SH-30 |
| Settlement SQL has 14 parameters but 13 supplied | SH-02 |
| Supplier payout UPDATE/JOIN is invalid PostgreSQL | SH-02, SH-06–09 |
| Razorpay native timestamp and money units rejected | SH-04, SH-07 |
| Cashfree local HELD state does not establish durable external hold | SH-06, EX-05 |
| No shared stock/demand commitment control; no connected inventory refresh | SH-12, SH-13 |
| One-off demand cannot become standing; late mandate does not wake recurrence | SH-24 |
| Started workflows/documents/enrichment can terminal-fail | SH-26, SH-29 |
| Reminder uniqueness and action/notification crash gap | SH-17 |
| Dispute award does not complete payout/closing; late reversals incomplete | SH-21, SH-23 |
| Partial/batched native disbursements exceed ingestion contract | SH-22 |
| Per-counterparty provider onboarding and carrier registry not connected | SH-11, SH-20 |
| Rediscovery downgrades verified jurisdiction without renewed KYB | SH-14 |
| Clean API image relies on undeclared global TypeScript | SH-01, SH-31 |

Other features that appear built are retained but must participate in integrated acceptance: protected relationship rights, rich specifications, negotiation/thread binding, waterfall mathematics, recurring authority, identity security, authentication, suppression, queue isolation, redrive, signed release and source receipts. Do not grant them blanket final-launch approval from older reports.

## 4. Dependency and execution order

These are build dependencies, not reduced product versions.

| Stage | Work | Exit condition |
|---|---|---|
| A — evidence and foundation | SH-00–02; begin EX-01–04 planning/onboarding when authorized | Clean declared toolchain, real local services, current runtime failures reproduced then fixed |
| B — complete the financial path | SH-03–12, SH-18–19, SH-21–23; EX-05 provider contracting in parallel | Each enabled route has an executable native protocol and exact accounting/authority contract |
| C — connect every counterparty and recurring operation | SH-13–17, SH-20, SH-24–25 | First contact through repeat order works without internal-ID entry or manual repairs |
| D — indefinite duties, bounded spending and operations | SH-26–32; infrastructure/service contracts in parallel | Recoverable workflows, refreshed evidence, monitored duties, safe wind-down, restored state |
| E — whole-system proof and immutable release | SH-33–34 | All exact cases and adversarial connected journeys pass on current source; trusted artifacts produced |
| F — external production gates | EX-01–12 and SLB-33–36 | Entity, law, providers, hosting, services and data actually ready; no invented receipts |
| G — controlled reality acceptance | SLB-37–38 | Explicitly authorized genuine transaction(s) and exact bank reconciliation through finished system |
| H — approved autonomous scope and economic validation | SLB-39–40 | Authorized ongoing operation; repeat transactions and measured net contribution, not assumed profit |

Engineering uses fake external providers without waiting for live credentials. Professional/provider procurement can proceed concurrently; final implementation must match the contract actually obtained. Missing underwriting may make one rail unavailable without stopping unrelated coding. No one is authorized to contact counterparties, spend, create accounts, publish, deploy or transact merely by reading this plan.

## 5. Engineering work packages

All start OPEN. The exact positive, negative and recovery test names, commands and covered paths are in [implementation-tasks.json](implementation-tasks.json). The following defines the expected production change.

| ID | Required implementation or verification |
|---|---|
| SH-00 | Build a connected local harness: actual PostgreSQL, Temporal, Redis, object storage, API/web/worker and native-schema external simulators. No direct SQL updates to advance trade states. Start from synthetic counterparties and use public/domain commands. |
| SH-01 | Declare/pin TypeScript, Node, packages and image inputs; prove clean API/web/worker builds. Fresh/upgrade/interrupted migrations, checksums and compatible rollback must work. |
| SH-02 | Repair all three demonstrated SQL defects and add typed row/parameter mappings. Execute economic evaluation, settlement insertion and payout claiming against PostgreSQL. Include dynamically constructed queries, not only the static scan. |
| SH-03 | Final quantity/price/cost/commission/tax snapshot is the single economic source. Identify actual payer, beneficiary and settlement treatment for every cost. Handle supported tax-inclusive/exclusive fees and reject unknown treatments before quoting. |
| SH-04 | Normalize each provider's timestamps, minor units, reference IDs, signatures, beneficiary facts and event states. Preserve raw bytes; poll API to recover missed webhooks and unknown outcomes. |
| SH-05 | Enforce current protection, signers, snapshot, funding and exact beneficiary evidence at identity release in API, database and provider surfaces. Order creation, authorization, stale evidence or assigned future proceeds cannot impersonate secured money. |
| SH-06 | Implement Cashfree capture/split/hold/eligibility/refund/reconciliation against actual approved semantics; prove delay/dispute beyond maximum eligibility or keep the route unavailable. |
| SH-07 | Implement Razorpay native checkout/capture/linked-account/transfer/hold/release/refund/fees, including loss of an HTTP response after the provider executed it. |
| SH-08 | Complete Escrow broker items, privacy, funding instructions, shipping/inspection, acceptance/rejection/return, disbursement and reconciliation. Do not assume buyer acceptance inside SableStone changes provider state. |
| SH-09 | Select and implement a named bank escrow API/process and real bank-feed contract. Funding, conditional split, refund, dispute and statement ingestion must work without a founder sending bank instructions. |
| SH-10 | Implement exact LC bank acknowledgement and proceeds events only when contracted; distinguish assignment from cash/funding. Unsupported strict-entitlement paths stay non-executable. |
| SH-11 | Invite each new counterparty into provider-hosted KYC, verification and account creation; consume callbacks/polls to register vendor/customer/linked-account references. No manual SYSTEM registry entry per supplier. |
| SH-12 | Atomically reserve stock and demand across all matches. Define reservation/commitment/consumption/release, partial lots, MOQ, updates, late funds and cancellation; do not fund overlapping commitments. |
| SH-13 | Schedule supplier stock/price/COA refresh and buyer demand reconfirmation. Preserve offer versions and lot identity; SAME/UPDATE/SOLD OUT replies must wake/reject the correct candidates. |
| SH-14 | Reviewed source access, full cursor coverage, dedupe, many-lane classification, KYB/sanctions/registration checks and renewal. Preserve stronger verification or re-verify on rediscovery; temporary misses wait fairly. |
| SH-15 | Complete autonomous Gmail first contact, structured clarification, inventory refresh, exact-thread negotiation and suppression. Renew watches, repair history gaps and avoid duplicate sends after unknown outcomes. |
| SH-16 | Malware-safe document ingestion, source spans, rich spec/unit/test-method normalization and authenticating checks. Separate source-stated from verified; sanitize anonymous copies and restrict originals. |
| SH-17 | Every required action has a usable org-scoped portal surface, deadline and transactionally created notification. Each reminder occurrence gets its own idempotency key; retrying that occurrence does not resend twice. |
| SH-18 | Pin the chosen IdP's actual protocol and subject format; invitation, signer authority, role membership, revocation, recovery, MFA/step-up and beneficiary-change fraud checks are complete. |
| SH-19 | Exact master, introduction, transaction, service/tax, settlement, recurring and dispute templates. Enduring relationship protection and changing per-trade economics remain separate, with fresh evidence where required. |
| SH-20 | Onboard/refresh carrier registry; consume authenticated tracking, 3PL documents or counterparty uploads; route external samples/inspection. Handle partial/delayed delivery and acceptance silence according to contract. |
| SH-21 | Provider-backed disputes, freezes, awards, returns, refunds and late reversals. Supplier award supplies valid payout authority and emits closing work; buyer award requires actual refund evidence, not local CANCELLED alone. |
| SH-22 | Ingest native provider reports and bank statements into exact many-to-many allocations. Partial payments, batches, fees, FX, deductions and reversals preserve source capacity and cannot double count. |
| SH-23 | Produce broker service invoices/credit notes and adviser-approved GST/withholding/FX/tax postings from final economics. Reconcile supplier material invoice separately; export filing-ready records and capture filing/payment receipts. |
| SH-24 | Allow explicit conversion of a one-off order into a durable standing mandate; create a wake-up event after late authorization, amendment/revocation and subsequent settlement. Prove 60/365-day schedules without waiting in real time. |
| SH-25 | Recurring reservations have independent expiry/reconciliation; committed cycles bind exact trade/snapshot and consume only on fresh secured entitlement. Execute tolerance/substitution and linked above-ceiling approval safely. |
| SH-26 | Durable recovery covers inbox, outbox, already-started workflows, documents, KYB, enrichment, notifications and provisioning. A prolonged outage must not leave valid duties in unreachable FAILED states. |
| SH-27 | Fair, resumable, high-recall candidate work; fixed sweep boundary/cursor under continuously arriving data; priority aging; per-provider/day/trade/lifetime atomic cost caps and budget reservation for unknown billable outcomes. |
| SH-28 | Whole-system security/privacy/retention: tenant isolation, authorization, SSRF, uploads, webhook replay, LLM injection, session security, secret/key rotation, non-deleting evidence IAM and lawful data lifecycle. |
| SH-29 | Health policies actually restrict affected actions and recover duties; new-risk suspension is separate from winding down existing money. Credential/approval renewal, provider shutdown and incident routing are executable. |
| SH-30 | Real cash contribution and overhead, not gross fee or projected LTV, drive business assessment. Calibrate from actual disjoint evidence, monitor prediction error and fall back to safe priors when the model degrades. |
| SH-31 | Reproducible Railway topology, private service connections, single migration job, typed environment/credential contract, release-bound deployment and health/rollback. Prove feature support rather than assume all storage is WORM or all Postgres is managed HA. |
| SH-32 | Restore DB, evidence versions, keys and workflow state into an isolated environment; re-fetch provider gaps and prove no duplicate money movement. Measure RPO/RTO and retain off-account recovery material. |
| SH-33 | Execute complete domestic/international first and recurring journeys, failures, concurrent allocations, disputes, refunds, batch payments, late reversals, load/soak and production-source mutation tests. |
| SH-34 | Build exact-source images, SBOM and execution artifacts, sign with the external trusted key, and bind production scope to fresh evidence. Local verification is allowed; source-text assertions and old signatures cannot substitute for current integrated execution. |

### Required cross-cutting decisions

1. **Money precision:** decimal strings internally and at boundaries; currency-specific provider minor units; explicit rounding and residual owner; no implicit INR default or cross-currency summation. Quote expiry and FX movement require reapproval when outside accepted bounds.
2. **Unknown provider result:** reconcile by provider reference/idempotency key before retrying a possibly executed create/transfer/refund. A timeout is neither success nor proof nothing happened.
3. **Physical allocation:** local reservation prevents SableStone double commitment; only supplier's current acceptance/reservation can support claims about stock sold elsewhere. If the supplier cannot commit a lot, do not accept buyer funding based on assumed availability.
4. **Cancellation after funding:** canceling a workflow does not cancel a bank/escrow transaction. Preserve money-resolution duties, obtain provider cancellation/refund/award and reconcile before closing.
5. **Legacy state:** migrations must quarantine/reconcile already stranded jobs and ambiguous historical rows. Never backfill fake acceptances, funding, creation times or bank receipts merely to satisfy new constraints.
6. **Advanced waterfall:** third-party allocation, reserves and provider deductions are only executable for exact proved provider capabilities. Economic risk haircuts are not automatically cash reserves payable to a supplier or SableStone.

## 6. External work: twelve deliverables

All are `BLOCKED_OPERATOR` until separately authorized and genuinely completed. An agent can prepare applications, questionnaires and implementation artifacts; it cannot invent a company, underwriting result, government registration or signed mandate.

| ID | Accountable external party | Deliverables needed before relevant activation | Recurring duty |
|---|---|---|---|
| EX-01 Entity and corporate authority | Founder/authorized signatory + company secretary | Entity choice and incorporation; registered office; PAN and applicable registrations; beneficial-owner records; board/agency/signing mandates; official notices address; ownership and IP assignments | Annual corporate filings, statutory records and changes; identify non-delegable signatory acts |
| EX-02 Brokerage and trade legal opinion | Indian commercial/environmental counsel; cross-border counsel where needed | Written broker-not-seller/PWM analysis; material vs waste scope; EPR/PWP registration verification duties; agency/marketplace/payment obligations; enforceable protected-account/tail/preexisting-account provisions; electronic signatures; pre-funding contract sequence; arbitration/refund/inspection/Incoterm allocation | Law/template change monitoring; renewed opinion for changed country, role, money flow or product use |
| EX-03 Tax and accounting mandate | CA/tax adviser | GST/service classification, place of supply/intermediary treatment, applicable registration/invoice/e-invoice rules, withholding/TDS/TCS questions, income tax, FX/import-export remittance documentation and exact chart/policies; calendar and delegated filing/payment authorization | Tax returns/payments, certificates, reconciliations, year end and audit duties |
| EX-04 Privacy and outreach position | Counsel/privacy service | Lawful source/access/outreach matrix by jurisdiction; privacy notices, objection/unsubscribe process, data processing contracts, cross-border transfer/retention/deletion/incident handling and applicable DPDP implementation dates | New-source review, rights requests, data incidents and changing law |
| EX-05 Banking and settlement approvals | SableStone bank + approved escrow/payment/bank providers | Operational company account; beneficiary verification/read access; at least one domestic and one international compatible rail for full target; exact commodity/broker/no-custody/conditional-release use case; holds, chargebacks, refunds, FX, limits, fees, liability and account onboarding; production credentials | KYC renewal, limit/price changes, reconciliation feeds, provider support and continuity |
| EX-06 Corporate communication | Domain registrar + Google Workspace/mail provider | Company-controlled domain/inboxes; SPF/DKIM/DMARC; OAuth/consent and Pub/Sub project; usable scopes, sender reputation/capacity, transactional vs acquisition policy; recovery ownership | Domain renewal, mail quotas, watch/token renewal, bounce/reputation monitoring |
| EX-07 Identity and account recovery | Selected IdP and authorized company identity administrator/service | Tenant, exact JWT/subject/role contract, invite/hosted KYC journey, verified domains, secrets, administrator recovery and user authorization model | Key rotation, invitations/revocations, compromised-account recovery |
| EX-08 Lawful data and economic APIs | Reviewed registries/data vendors/KYB/freight providers | Current accessible CPCB/SPCB/PCC and manufacturer sources; Brave/Hunter or approved alternatives; optional Apollo/Trulioo only if needed; geography-complete screening; carrier/freight/inspection quotes with current billing and use rights | Source/credential expiry, access changes, freshness, actual quotas/tariffs and lawful alternatives |
| EX-09 Hosting and recovery services | Railway + selected DB/Temporal/storage/secret/monitoring providers | Company-owned accounts, funded operating budget, region/data terms, service limits, private networking, TLS, required storage retention, backups/PITR, support and recovery access | Service billing, platform incidents, capacity, security updates, renewal and restore drills |
| EX-10 Logistics, inspection and dispute service contracts | Carriers/3PLs/inspectors/escrow dispute authority | Identified service authority, tracking/evidence methods, inspection scope, sample handling, return/refund rules, escalation SLAs, costs assigned to buyer/supplier, fraud verification | Failed shipments, quality disputes and changed counterparties without founder adjudication |
| EX-11 Outsourced statutory/technical exception coverage | CA/CS/counsel + contracted incident/recovery service if founder independence is required | Named primary/backup service, limited authority, budget, authenticated support channel, response/escalation time, off-hours responsibility and succession/recovery plan | Security incidents, unusual filings, failed automation and provider requests that cannot legally be automated |
| EX-12 Approved operating and launch policy | Founder/authorized corporate signatory | Explicit countries/rails/products/ticket/quantity/concurrency limits; operating cash and lifetime budgets; allowable external services; pilot and later autonomy authority; loss/stop rules; owner distribution policy | New scope/budget decisions and corporate acts that cannot be delegated |

These services are not a hidden founder inbox. They are actual contracted operating dependencies and costs. If the user declines external operational coverage, the honest fallback is safe pause on non-automatable exceptions, with no promise of uninterrupted unsupervised operation.

### Questions the provider must answer in writing

- Is SableStone a broker beneficiary without becoming principal, cargo funder, payment custodian or guarantor under the provider contract?
- Do merchant terms create chargeback recourse, negative balances, collateral, rolling reserves, minimum turnover, pre-funding or settlement liquidity obligations? If incompatible with zero cargo-credit exposure, reject the rail.
- Can every new buyer/supplier complete onboarding without SableStone manually registering IDs? Who owns beneficial-owner and bank verification?
- Can counterparties fund under the required disclosure sequence? What does the provider expose in checkout, emails, invoices and portal pages?
- What exact event establishes secured funds, exact beneficiary entitlement, hold conditions and final disbursement? Which actions remain reversible and who bears that risk?
- Can supplier release remain conditional through late delivery and disputes, not merely until a date elapses? Who can release/freeze/refund and under what mandate?
- How are partial shipment, price adjustment, refund, tax, withholding, chargeback and late reversal allocated? Is bank settlement batched? What reports map batches to orders?
- Are reliable callbacks, fetch/list/report APIs, idempotency and automated support/dispute mechanisms available for this account? What is the outage/manual fallback?

Approval to use an API is not proof of these capabilities. Scope-specific contracts, native sandbox behavior and a bounded real journey must agree.

## 7. Rail-by-rail completion boundary

| Rail | Required proof | Fail-closed condition |
|---|---|---|
| Indian bank escrow | Exact signed buyer/supplier/broker waterfall, custody, funding, delivery/award release, API or contractually executable authenticated bank process, read-back and bank feed | Bank requires a founder email/manual release for ordinary trades or does not acknowledge broker rights |
| Escrow.com | Approved merchandise/countries/currencies, broker item, provider privacy, secured schedule, shipping/inspection/acceptance/dispute/return actions, broker payout and bank reference | Marketing/docs or created transaction only; unsupported merchandise/country or disclosure sequence |
| Razorpay Route | Exact eligibility/use case and merchant recourse; minor units; captured payment, correct linked account, verified held transfer, conditional release, refunds and settlement reports | Unsupported recourse, missing hold/recipient evidence, insufficient onboarding or unproved privacy |
| Cashfree Easy Split | Exact approved role/custody, captured payment/split and a demonstrably adequate conditional hold throughout contractual deadlines/disputes; order+vendor release and reports | Ordinary finite defer window is treated as an indefinite acceptance hold |
| LC/bank proceeds | Actual bank recognition and applicable legal rights, document compliance and proceeds events, precise security state and accepted risk | Mere assignment is labeled FUNDS_SECURED; manual founder documentary handling required |

The Cashfree limitation is material: the documented defer setting is a delay in days and cannot be extended beyond the maximum eligibility date through that API. A local HELD/FROZEN flag cannot alter those external facts. [Cashfree deferred-settlement documentation](https://www.cashfree.com/docs/payments/split/settlements/delay/vendor-level)

Escrow's documented broker/privacy model is a promising capability input, not SableStone-specific approval. [Escrow transaction documentation](https://www.escrow.com/api/docs/create-transaction)

## 8. Railway production topology and deployment acceptance

Keep the proposed stack; prove and operate each part:

```
Company domain / TLS / ingress protection
  +-- Next.js counterparty web
  +-- API and authenticated provider webhooks
  +-- continuous workers (no request-time dependency)
          |
          +-- PostgreSQL: transactions, books, inbox/outbox, ledger
          +-- Temporal: durable timers and workflow history
          +-- Redis: cache/rate limits only
          +-- versioned Object Lock evidence storage
          +-- secret/key service and restricted signing authority
          +-- metrics/logs/traces and external incident destination
```

Railway may host app/API/workers and appropriate database/cache services. Choose managed Temporal or a fully tested self-hosted production topology; the local compose file is not a production operations plan. Use an object store proven to meet retention/IAM requirements, such as appropriately configured S3; “S3-compatible” alone is not sufficient. Object Lock protection is version-specific and requires versioning, so store and read exact object version identities as well as hashes. [AWS Object Lock documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)

Before deployment:

1. Pin runtime/build tools and image digests; build API, worker and web from the same verified source. No development-only global tools or secrets inside images.
2. Configure distinct test/staging/production accounts and databases. Test restore networks cannot reach money/outreach endpoints.
3. Run schema migration once with migration-only privileges; runtime roles cannot alter schema or mutate append-only evidence. Test deploy ordering against running old/new worker versions.
4. Validate private database/cache/Temporal networking, TLS, actual connection/pool limits, durable storage, regions, provider egress allowlists and webhook ingress.
5. Configure a secret manager and scoped credentials; remove production reliance on an operator laptop or unbacked local key file. Keep signer trust roots separate from artifacts they authenticate.
6. Verify backup/PITR and restore behavior for the actual selected Railway/Postgres service, not a generic platform assumption. Keep an independent encrypted recovery copy and tested access to keys. [Railway PostgreSQL documentation](https://docs.railway.com/databases/postgresql)
7. Deploy inertly with `DEPLOY` scope. Smoke test authentication, provider simulation, storage retention, telemetry and schema; only later authorize read-only real discovery, bounded outreach and money capabilities.
8. Prove rollback, worker restart, webhook backlog catch-up, credential expiry and database restoration without duplicate external actions.

Initial engineering targets, to be approved against service cost/capabilities: RPO at most five minutes for general state, RTO at most sixty minutes, and **no unaccounted acknowledged money event** after reconciliation with provider/bank replay. These are targets, not current guarantees. If the selected services cannot meet them, choose compatible services or obtain an explicit revised risk scope.

## 9. Acquisition and market population

Build software for all eight families before live contact, but do not fabricate an offer book by scraping directories. A registry company is a lead, not current stock, buyer permission, creditworthiness or recurring demand.

1. Review currently accessible CPCB/SPCB/PCC sources and their permitted access. Record pagination, retrieval dates, inaccessible portions and duplicates. Do not assume an earlier portal migration date or a directory's complete coverage is current truth.
2. Resolve identity and country from evidence; verify registrations for the actual entity, activity, material and validity period. Maintain producer/converter/application profiles as separate lanes.
3. Resolve business contacts through permitted sources; verify deliverability and outreach basis separately. Honour objection/suppression across all adapters; never evade quotas by rotating accounts.
4. With full software verified and outreach authorized, obtain supplier net price, currency, price basis, application, grade, test method, MFI/density, colour, ash/moisture/contamination limits, PCR/PIR, batch, capacity, MOQ, location, lead time, terms, expiry, COA/TDS and available samples. Unknown fields cause questions, not guesses.
5. Only contact buyers with real current deeply compatible inventory and plausible route/economics. Show sanitized quantity/spec/location/price-basis/expiry; indicative is not executable or guaranteed delivered pricing.
6. Support ordinary messy email, attachments, units and languages within tested extraction coverage. Bind counteroffers to exactly one negotiation and buyer. No autonomous contractual improvisation or early identity leakage.
7. Refresh supply and demand automatically; respect supplier lot commitment and standing buyer authority. Reacquisition is not required for every cycle, but current inventory and instructions always are.
8. Rank by conservative expected net relationship contribution using real costs, authorization horizon, fill/close/settle probabilities and days to cash; preserve fair exploration and cheap clarification before paid quotes.

Gmail watches must be renewed and history gaps repaired; authenticated push alone is not a complete ongoing mail service. [Google Gmail push documentation](https://developers.google.com/workspace/gmail/api/guides/push)

Population exit evidence is a measured funnel, not an arbitrary “entire market loaded” claim: accessible sources/organizations, verified contacts, qualified entities, real valid offers/demands, deeply compatible pairs, executable routes, current prices, replies, declines and funded/settled conversions. Unsupported or inaccessible portions remain UNKNOWN. A lack of viable deals is a legitimate market result, not permission to loosen gates.

## 10. Every exception has an owner, action and deadline

| Event | Software action | Ultimate owner and completion evidence |
|---|---|---|
| No reply, no stock, unknown ceiling | Clarify, wait with due date, refresh or expire; no paid quote without budget/authority | Counterparty response or policy-valid expiry |
| Verification fails or sanctions uncertainty | Block new relationship/commitment; recheck only under approved policy | Qualified verification provider/counsel; immutable result |
| Buyer/supplier refuses terms | Decline without revealing protected identity | Recorded refusal/expiry; no financial obligation created |
| Funding timeout or late/partial funding | Reconcile actual provider state, prevent duplicate funding, invoke permitted cancel/refund | Bank/escrow actual refund or secured current instruction |
| Provider HTTP timeout after action | Query known idempotency/reference before retry | Authenticated provider result, not guessed success/failure |
| Dispatch/delivery late, partial or disputed | Notify/remind, hold actual provider release, obtain evidence, follow contract | Carrier/inspector/provider authority and accepted resolution |
| Supplier wins dispute | Record provider award as release authority, release appropriately, emit closing work | Actual supplier/broker disbursements and reconciliation |
| Buyer wins dispute/return | Initiate permitted return/refund, adjust commission/tax, reconcile | Provider refund and bank/ledger evidence |
| Fee paid partially/batched/reversed | Allocate, reconcile, make corrective postings; restrict affected scope | Exact provider/bank/invoice/tax ledger match |
| Workflow or connector outage | Backoff/circuit-break fairly; redrive already-started duties; catch up on recovery | No stranded valid obligations; bounded recovery evidence |
| Credential, approval, KYC or domain expiry | Renew through authorized mechanism or stop affected new business before expiry | Real current renewal, never self-approved authority |
| Budget, reserve or cash runway exhausted | Stop new paid acquisition/commitment; continue funded-trade resolution | Restored permitted budget or orderly wind-down |
| Security incident/data rights request | Isolate, preserve lawful evidence, revoke/rotate, notify appointed service | Incident/rights process completed under law and contract |
| Unanticipated legal act/provider signatory request | Route to legally authorized external service; otherwise pause affected scope | Genuine signatory/professional result; founder may still be legally necessary |

Separate authority to **create new risk** from authority to **resolve already-existing obligations**. A kill switch or expired outreach permit must not disable bank-event ingestion, evidence preservation, lawful refunds or reconciliation. A `WIND_DOWN` capability needs an explicit, narrow legal/provider mandate; it cannot create new trades or give the software permission to waive a dispute.

Recommended operational checks: continuous money/inbox/payout/workflow lag; hourly duty/deadline/budget/cursor checks; daily invoice/provider/bank reconciliation and approaching-expiry review; scheduled stock/demand/KYB renewal; monthly dependency/restore/economic review; statutory duties on the adviser-approved calendar. Timings must be encoded and tested rather than depend on a founder reading an alert.

Alerts go to contracted services where action is required. Automatic health must cause the intended scoped restriction, not just emit a log. Counterparty reminders are customer actions, not founder interventions. Technical support can repair an incident under a bounded mandate, but security-sensitive code changes still require tests and an authorized release, not unrestricted production self-modification.

## 11. Operating capital, spending and genuine profitability

Zero cargo capital is an architectural rule. Zero company operating cost is not. Before live activation, obtain actual quotes and an approved, funded operating budget for:

- entity/registered office/legal/tax/privacy setup and recurring filings;
- banking/provider onboarding, account minimums, FX, payout/escrow fees and any incompatible recourse/collateral;
- Railway compute, databases/PITR, Temporal, cache, storage/retention/egress, secrets and observability;
- domain/Workspace/IdP and transaction mail;
- lawful search/enrichment/KYB/sanctions, document/LLM extraction and economic quote APIs;
- outsourced legal/accounting/incident support and any chosen insurance;
- refund/dispute/chargeback liabilities actually imposed on the broker, if compatible with its permitted role.

Each expense has currency, owner, billing period, worst-case/variable unit charge, tax treatment, cancellation mechanism, API enforcement capability and lifetime budget. Defaults for unapproved paid activity are zero. Do not call an unknown provider charge free. Reserve budget for a potentially billable request before sending it; reconcile unknown outcomes before releasing that reservation. Provider/cloud billing caps must be real limits or conservatively bounded exposure, not merely local warning emails.

Define separately:

```
broker service revenue = earned commission excluding pass-through taxes
trade contribution = service revenue - trade-attributable company costs/adjustments
company operating profit = sum(trade contribution) - all fixed operating costs
cash available = cleared unrestricted company cash
                 - tax obligations - refunds/known liabilities - approved operating reserve
```

Withholding credits/receivables are not cleared cash. Buyer/supplier-owned freight is not SableStone cash expense, but it affects the buyer's all-in economics. Do not double-count it. Projected relationship LTV is not revenue. A bank credit including GST is not entirely profit.

Initial commission floor/cap proposals from the original brief are policy hypotheses, not industry standards or promises. Approve them only with tax-consistent economics and real commercial response. Optimization cannot waive commission, take credit exposure or spend past budgets to obtain apparent growth.

The system should automatically reduce or stop a persistently negative acquisition lane, request cheaper/current sources or rematch an authorized substitute. It must not open new countries/providers, create paid accounts or expand budgets on its own. Any reinvestment formula is approved in advance and operates only on unrestricted cleared cash after liabilities.

Break-even must use measured contribution per kg/trade, not headline commission:

`required settled volume = fixed operating cost / measured positive contribution per kg`.

If contribution is missing or non-positive, break-even is UNKNOWN/unattainable under current economics. Do not report a fictional target volume or guaranteed return.

## 12. Acceptance: what replaces the checklist

### Exact engineering cases

Every SH task has three named acceptance commands in the task specification: positive production behavior, forbidden behavior and restart/recovery. The implementation must create the planned modules, supporting native fixtures and execution artifacts. Missing modules are OPEN implementation work, not skipped passes. Add real source mutations at the relevant monetary/authorization choke points and require those mutations to be killed. Restore mutated files byte-for-byte.

Use real local services for SQL, workflow timers/history, locks, outbox/inbox, object versioning and concurrency. Fakes exist only at deliberately controlled external boundaries. An object-store fake cannot prove actual cloud WORM; a provider simulator cannot prove live underwriting. Keep that distinction in every report.

### Mandatory connected journeys

| Case | Required end-to-end behavior |
|---|---|
| First domestic deal | Start with discovered synthetic supplier/buyer, complete real portal/worker/DB path through fee/bank/invoice/tax reconciliation without admin repair |
| First international deal | Same depth with actual foreign jurisdiction/currency and selected provider protocol, not a manually set international flag |
| Quantity race | One 100 MT lot, two simultaneous 80 MT orders: combined commitment cannot exceed 100 MT; no unsupported second funding |
| Negotiation continuity | Same buyer, two threads; one accepts a concession. Only that match's exact final price/fee/cost/tax snapshot reaches settlement |
| Identity/fee safety | Provider-created/unfunded transaction, wrong party, wrong amount, revoked authority, unsigned snapshot and identity-bearing document each block disclosure |
| Funding reliability | Native timestamps/minor units, under/overpayment, duplicates, lost HTTP response, webhook gap and bank-funded late event reconcile without double execution |
| Supplier release | Before acceptance fails; accepted delivery or valid supplier award succeeds exactly once; unresolved dispute stays externally held |
| Partial/batched cash | Multiple orders in one bank settlement, partial broker disbursement, deductions/withholding and one late reversal balance with source residuals |
| Late standing mandate | Complete one-off order; allow recurrence workflow to finish; buyer later authorizes via portal; next cycle starts without manual intervention |
| Recurrence branches | 1/60/365-day cadence, expired original RFQ, price within/above bounds, approve/decline, reserve expiry, partial tolerance, qualified substitution and mandate revocation |
| Communication continuity | First mail, two subsequent reminders, concurrent replies, unsubscribe, bounced mail, OAuth/watch/history gap, multilingual supported extraction and unsafe attachment |
| Prolonged outage | Crash after external action or outbox publication; exceed old retry cutoff; restore DB/Temporal/provider; all valid duties recover or legally terminate |
| Evidence lifecycle | Rediscovery, changed country, completed prior KYB, expired COA, source inaccessible, retention/legal hold/deletion request and credential rotation |
| Operations | Budget cap under concurrency, ready-job starvation, bounded full candidate sweep, provider disablement, authority expiry and safe wind-down |
| Restore/rollback | Recovered DB/object/workflow state plus provider catch-up produces no missing/double ledger entries or duplicate payouts |

Run clean builds, all previous exact Plan 66 cases, migration/constraint tests, API/browser tests, new cases, load/soak, dependency scans and source mutations. A proposed 72-hour unattended staging soak supplements—not replaces—time-skipped long-cadence and failure tests. Record actual duration, workload and results. Disable public provider egress during local verification.

Measure founder interventions from the executed API/workflow/support trace, not by printing `manual_steps=0`. Counterparty actions and pre-authorized external service actions are classified separately. Fixture setup may create synthetic identities, but it must not insert ready-made acceptances, fee locks or ledger outcomes to skip the product path under test.

## 13. External gate sequence and avoiding circular activation

The first real trade cannot require a previous real trade as a precondition. Use distinct, explicitly authorized scopes:

1. **BUILD / SH-34:** all software and local adversarial cases complete. No live effects.
2. **PROVIDER_READY / SLB-33–34:** EX-01–08/10–12 deliver legally and technically sufficient current evidence for intended routes. Sandbox credentials are not production approval.
3. **DEPLOYED / SLB-35:** deploy exact release inertly; prove TLS, secrets, retention, restore, telemetry and rollback with EX-09 services.
4. **POPULATION / SLB-36:** authorize lawful real read-only discovery. Genuine supply/demand collection requires separate bounded outreach authority after the full software build; the gate must distinguish scraped leads from counterparty-confirmed offers/demand.
5. **BOUNDED PILOT / SLB-37:** authorize an allowlisted real transaction scope, maximum amount/quantity/concurrent exposure/fees/countries/providers and expiry. Machine selects within that scope or stops. No simulated receipts or silent manual database repair. Pilot authority does not require an earlier real trade.
6. **RECONCILED / SLB-38:** actual buyer funding, shipment, acceptance/award, supplier payment, SableStone disbursement, bank credit, invoice and tax allocation agree. Resolve any incident, reverify changed code and repeat affected cases before proceeding.
7. **AUTONOMOUS APPROVED SCOPE / SLB-39:** explicit subsequent authority allows ongoing operation under tested route/budget/limits; software enforces those bounds. It does not autonomously increase them.
8. **REPEATABLE / SLB-40:** obtain genuine repeat orders under real mandates and measure full operating economics over a representative interval. One profitable transaction is not evidence of a sustainably profitable company.

For full domestic+international launch, perform real acceptance on each enabled route/geography and prove a real recurring transaction, with fresh entitlement, before claiming the full target. Optional unavailable rails remain excluded and clearly documented. A narrow pilot is a reality test of the complete product, not permission to ship incomplete software.

### Global autonomous activation expression

```
current_complete_software_verification
AND exact_trusted_release_deployed
AND legal_entity_tax_privacy_signing_authority_current
AND operating_bank_and_required_provider_contracts_current
AND domestic_and_international_required_routes_proved
AND per_counterparty_onboarding_and_conditional_release_proved
AND infrastructure_restore_security_observability_proved
AND lawful_current_population_and_outreach_basis
AND genuine_pilot_and_bank_invoice_tax_reconciliation
AND fresh_recurring_order_proved
AND operating_budget_and_external_exception_coverage_authorized
AND founder_routine_manual_steps_measured_zero
AND explicit_autonomous_scope_authorization
```

This is an approval condition, not a promise of revenue. If an element expires after launch, restrict the affected new activity while maintaining separately authorized existing-obligation recovery. Do not auto-generate fresh legal/underwriting approvals to keep the expression true.

## 14. Evidence deliverables and truthful completion

Each engineering execution artifact records source/image digest, exact case/command, actual service versions, run times, fixture/native schema versions, persisted assertions, negative cases, mutation results, network-effect classification and failure output. A signature authenticates these results; it does not make weak tests strong.

External packets record issuer, exact entity/account/use case/scope, date/effective/expiry, permitted actions/limits, original document or authenticated response, verification method and hash. Keep secrets/private legal/KYC data out of Git; the repository contains only redacted references and status.

Required completion artifacts include:

- Current-source local integrated and adversarial execution report; clean images, SBOM and trusted signatures.
- Professional legal/tax/privacy memo set and actual company/bank/signatory records.
- Native provider contract/underwriting/onboarding/capability matrix and real sandbox/production results for each enabled route.
- Deployment/config/retention/IAM/backup/restore/rollback measurements.
- Actual population coverage and commercial funnel facts, with UNKNOWN gaps.
- Genuine pilot and recurring trace: contract, funding, shipping, acceptance, supplier payout, broker fee, bank and tax reconciliation.
- Approved operational policies, budgets, external service mandates, renewal calendar and wind-down test.
- Measured net contribution and operating-cost report, without passing off predictions as profitability.

No hand-authored success receipt, fresh actor requirement, extra reviewer gate, new coordination platform or GitHub Actions installation is introduced. The existing single-agent runner records actual verification; the same agent may implement and adversarially verify.

## 15. What must be decided before real external execution

These are pending decisions, not questions blocking offline engineering:

1. Legal entity, ownership/signing authority, registered office and incorporation professional.
2. Domestic and international country/currency scope; products/applications excluded for legal/quality reasons.
3. Actual bank/escrow candidates and whether their contracts preserve the no-custody/no-credit model.
4. Setup budget, monthly/lifetime operating caps and funded reserve; which costs buyer/supplier can actually agree to pay.
5. CA/CS/counsel and technical incident service mandates if founder-independent exception handling is required.
6. Company domains, Workspace/IdP/cloud account ownership, regions and recovery custodians.
7. Pilot limits, autonomous scope limits, stop rules and reinvestment/distribution policy.

No reliable calendar date for first revenue can be given until those decisions, underwriting and genuine market response exist. Track engineering by passed integrated cases; track external work by provider/professional milestones. Re-estimate engineering after SH-00–02 establishes actual runtime coverage. Do not use coding speed to predict bank approval, carrier delivery or customer demand.

## 16. Current-source references and re-verification duties

Provider specifications and legal requirements can change. The following primary sources were checked for planning on 5 September 2026; they are inputs to implementation/professional review, not approvals:

- Cashfree's finite delay behavior is covered in §7; implement the current approved API contract and reverify after provider changes.
- Escrow's broker items/privacy are covered in §7; verify the entire transaction lifecycle for the actual merchandise/account.
- Native Razorpay payment event examples inform SH-04/07; normalize provider units/timestamps instead of adapting fixtures to current parser assumptions. [Razorpay payment webhooks](https://razorpay.com/docs/webhooks/payments/)
- Gmail watch and cursor duties inform SH-15; verify account-specific scopes and current sender rules. [Google Gmail push](https://developers.google.com/workspace/gmail/api/guides/push)
- Object version/retention behavior informs SH-28/32. [AWS S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)
- Railway service and recovery configuration must be validated on the actual selected deployment, including current cost/support obligations. [Railway PostgreSQL](https://docs.railway.com/databases/postgresql)
- Counsel/CA must determine current intermediary treatment and applicable tax law, rather than assume offshore commission is an export exemption. [CBIC intermediary clarification](https://cbic-gst.gov.in/pdf/Circular-No-159-14-2021-GST.pdf)
- Privacy work must use the notified rules, corrigenda and effective-date schedule relevant at activation. [MeitY DPDP rules and enforcement documents](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025)

The government recycled-content figures, source portal availability, provider turnover rules, API prices and free quotas in earlier conversations are not frozen planning facts. Reverify them before using them in acquisition claims, tax treatment, procurement budgets or eligibility decisions.

## 17. Immediate next work

Execute `SH-00` then `SH-01` and `SH-02`: establish the connected harness, declare the clean toolchain and reproduce/fix the actual database money-path failures. Progress the dependency-ready SH tasks from there; prepare EX packets in parallel but do not submit or spend without authorization.

From the portfolio root, the existing commands expose and execute each task:

```bash
python3 scripts/verify-plan-completion.py --manifest plans/completion/66.json --task SH-00 --mode brief
scripts/run-plan-until-blocked.sh --task 66/SH-00 --once
```

The first execution is expected to fail until SH-00's planned harness/test modules exist. Implement the behavior and exact cases; do not turn missing tests into a skipped or passing result. `--mode schema` validates registration only, not software or live readiness.

Completion of this plan means the requirements and acceptance work are organized. It does not change the baseline NO-GO verdict. Closure comes from passing the specified production behavior and obtaining genuine external evidence.
