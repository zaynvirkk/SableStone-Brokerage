import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_capability_receipts_are_exactly_typed_and_current():
    build = subprocess.run(
        ["npm", "run", "build"], cwd=ROOT, text=True, capture_output=True
    )
    assert build.returncode == 0, build.stdout + build.stderr
    result = subprocess.run(
        ["node", "scripts/authority-receipt-kind-contract.mjs"],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in (
        "exact_kind=required",
        "marketing=blocked",
        "expired=blocked",
        "cross_capability=blocked",
        "retrieved_before_use=required",
        "per_use=required",
        "expired_after_start=blocked",
        "provider_approval_after_start=blocked",
        "activation_after_start=blocked",
        "authority_cache=none",
    ):
        assert claim in result.stdout


def test_every_load_bearing_production_gate_names_its_authority_kind():
    expected = {
        "src/runtime/discovery_service.ts": "DISCOVERY_SOURCE_REVIEW",
        "src/runtime/enrichment_jobs.ts": "CONTACT_ENRICHMENT_APPROVAL",
        "src/connectors/commercial_extraction.ts": "COMMERCIAL_EXTRACTION_APPROVAL",
        "src/runtime/document_jobs.ts": (
            "DOCUMENT_EXTRACTION_APPROVAL",
            "DOCUMENT_VERIFICATION_APPROVAL",
        ),
        "src/runtime/kyb_jobs.ts": "KYB_PROVIDER_APPROVAL",
        "src/runtime/economic_jobs.ts": (
            "ECONOMIC_QUOTE_PROVIDER_APPROVAL",
            "PRICING_POLICY_APPROVAL",
            "NEGOTIATION_POLICY_APPROVAL",
        ),
        "src/runtime/accounting.ts": "TAX_POLICY_APPROVAL",
        "scripts/start-production-api.mjs": "BANK_WEBHOOK_PROVIDER_APPROVAL",
        "scripts/start-production-worker.mjs": "BANK_WEBHOOK_PROVIDER_APPROVAL",
    }
    for relative, kinds in expected.items():
        source = (ROOT / relative).read_text()
        if isinstance(kinds, str):
            kinds = (kinds,)
        for kind in kinds:
            assert kind in source, f"{relative} lacks {kind}"

    bootstrap = (ROOT / "src/runtime/bootstrap.ts").read_text()
    for kind in (
        "OPERATOR_AUTHORIZATION",
        "ENTITY_REGISTRATION",
        "PROFESSIONAL_LEGAL_MEMO",
        "PROFESSIONAL_TAX_MEMO",
        "DEPLOYMENT_VERIFICATION",
    ):
        assert kind in bootstrap
    assert "a.authority_kind=$5" in bootstrap

    guarded_connectors = (
        "src/connectors/settlement_http.ts",
        "src/connectors/commercial_extraction.ts",
        "src/connectors/documents.ts",
        "src/connectors/economic_quotes.ts",
        "src/connectors/enrichment.ts",
        "src/connectors/kyb.ts",
        "src/connectors/bank_http.ts",
        "src/connectors/gmail.ts",
        "src/runtime/accounting.ts",
    )
    for relative in guarded_connectors:
        source = (ROOT / relative).read_text()
        assert "authorityguard" in source.lower(), f"{relative} lacks a per-use authority guard"
        assert "assertCurrent()" in source, f"{relative} does not recheck authority"

    guard_factories = (
        "src/runtime/provider_factory.ts",
        "src/runtime/enrichment_jobs.ts",
        "src/connectors/commercial_extraction.ts",
        "src/runtime/document_jobs.ts",
        "src/runtime/kyb_jobs.ts",
        "src/runtime/economic_jobs.ts",
        "scripts/start-production-api.mjs",
        "scripts/start-production-worker.mjs",
    )
    for relative in guard_factories:
        source = (ROOT / relative).read_text()
        assert (
            "DatabaseAuthorityUseGuard" in source
            or "DatabaseProviderApprovalUseGuard" in source
        ), f"{relative} does not install a per-use authority guard"

    bootstrap = (ROOT / "src/runtime/bootstrap.ts").read_text()
    assert "DatabaseActivationUseGuard" in bootstrap
    assert "activationGuard" in (ROOT / "src/api/server.ts").read_text()
    worker = (ROOT / "scripts/start-production-worker.mjs").read_text()
    assert worker.count("runtime.activationGuard") >= 4
    api = (ROOT / "scripts/start-production-api.mjs").read_text()
    assert api.count("runtime.activationGuard") >= 2
    for relative in ("src/runtime/activities.ts", "src/runtime/supervisor.ts"):
        source = (ROOT / relative).read_text()
        assert "activationGuard" in source
        assert "assertCurrent()" in source
