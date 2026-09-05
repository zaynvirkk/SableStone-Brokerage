# Production checklist

**Current status: NO-GO.** Checked historical items below are not proof that
the production runtime completes a trade. Follow the [complete launch plan](launch/MASTER-PLAN.md)
and its `SH-00`–`SH-34` tasks, 105 launch behavioral cases and external
`EX-01`–`EX-12` deliverables. The local harness passes its offline cases and
honestly skips only unavailable disposable services or the operator-held release
key. Do not reactivate from this historical checklist.

- [x] Offline root and web builds pass.
- [x] Full synthetic journey and rejection suite pass deterministically.
- [x] Identity, authorization, webhook and ledger source mutations are killed.
- [x] Root and web dependency audits report zero known vulnerabilities at build time.
- [x] SBOM and cryptographic build attestation generated.
- [x] Live trading, outreach, settlement and production providers remain false.
- [ ] SLB-33 genuine professional/entity evidence.
- [ ] SLB-34 genuine provider approval and credentials.
- [ ] SLB-35 verified deployment/restore/rollback receipts.
- [ ] SLB-36 lawful current population receipts.
- [ ] SLB-37 explicit bounded-live authorization and real journey.
- [ ] SLB-38 real bank/provider/tax reconciliation.
- [ ] SLB-39 explicit launch decision.

Unchecked items are release blockers for provider or live operation, not defects
that automatic fixtures are permitted to waive.
