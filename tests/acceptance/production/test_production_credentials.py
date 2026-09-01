import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_production_credentials_are_receipt_fingerprint_and_revocation_bound():
    build = subprocess.run(["npm", "run", "build"], cwd=ROOT, text=True, capture_output=True)
    assert build.returncode == 0, build.stdout + build.stderr
    result = subprocess.run(["node", "scripts/production-credential-contract.mjs"], cwd=ROOT, text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in ("fingerprint=bound", "wrong_secret=blocked", "wrong_scope=blocked", "wrong_provider=blocked", "missing=blocked", "revocation=checked", "self_assertion=removed", "per_use=required", "revoked_after_start=blocked", "authority_cache=none"):
        assert claim in result.stdout


def test_every_live_counterparty_connector_requires_a_credential_binding():
    expected = {
        "src/runtime/provider_factory.ts": ("SETTLEMENT_API", "SETTLEMENT_WEBHOOK"),
        "src/runtime/enrichment_jobs.ts": "CONTACT_ENRICHMENT_API",
        "src/connectors/commercial_extraction.ts": "COMMERCIAL_EXTRACTION_API",
        "src/runtime/document_jobs.ts": ("DOCUMENT_EXTRACTION_API", "DOCUMENT_VERIFICATION_API"),
        "src/runtime/kyb_jobs.ts": "KYB_API",
        "src/runtime/economic_jobs.ts": "ECONOMIC_QUOTE_API",
        "scripts/start-production-api.mjs": ("GMAIL_OAUTH", "BANK_WEBHOOK"),
        "scripts/start-production-worker.mjs": ("GMAIL_OAUTH", "BANK_WEBHOOK"),
    }
    for relative, capabilities in expected.items():
        source = (ROOT / relative).read_text()
        if isinstance(capabilities, str):
            capabilities = (capabilities,)
        assert "assertCurrentCredentialBinding" in source
        for capability in capabilities:
            assert capability in source, f"{relative} lacks {capability}"
    guarded_connectors = (
        "src/connectors/settlement_http.ts",
        "src/connectors/gmail.ts",
        "src/connectors/commercial_extraction.ts",
        "src/connectors/documents.ts",
        "src/connectors/economic_quotes.ts",
        "src/connectors/enrichment.ts",
        "src/connectors/kyb.ts",
        "src/connectors/bank_http.ts",
        "src/runtime/accounting.ts",
    )
    for relative in guarded_connectors:
        source = (ROOT / relative).read_text()
        assert "credentialguard" in source.lower(), f"{relative} lacks a per-use credential guard"
        assert "assertCurrent()" in source, f"{relative} does not recheck credential authority"
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
        assert "DatabaseCredentialUseGuard" in (ROOT / relative).read_text(), f"{relative} does not install the per-use guard"
    combined_startup = (ROOT / "scripts/start-production-api.mjs").read_text() + (ROOT / "scripts/start-production-worker.mjs").read_text() + (ROOT / "src/runtime/provider_factory.ts").read_text()
    assert "SABLESTONE_GMAIL_AUTHORIZED" not in combined_startup
    assert "credentialVerifiedAt" not in combined_startup
    migration = (ROOT / "migrations/0050_production_credentials.sql").read_text()
    for invariant in ("credential_fingerprint text not null", "production_credential_revocations", "production_credential_bindings_no_update_delete", "production_credential_revocations_no_update_delete"):
        assert invariant in migration
