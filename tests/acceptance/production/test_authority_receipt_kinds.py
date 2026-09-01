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
