import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def _run(*argv: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, cwd=ROOT, text=True, capture_output=True, check=False)


def test_authority_registry_fails_closed() -> None:
    build = _run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = _run("node", "scripts/authority-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "marketing_not_approval=true" in result.stdout
    assert "public_docs_not_underwriting=true" in result.stdout
    assert "drift_revokes=true" in result.stdout
    assert "expiry_revokes=true" in result.stdout


def test_authority_receipts_preserve_body_proposition_and_review() -> None:
    source = (ROOT / "src" / "authority.ts").read_text()
    migration = (ROOT / "migrations" / "0004_authority.sql").read_text()
    for field in ("bodySha256", "bodyObjectKey", "proposition", "effectiveAt", "reviewAt", "expiresAt", "reviewedBy"):
        assert field in source
    assert "authority_receipts_no_update_delete" in migration
    assert "state = 'AVAILABLE' AND authority_receipt_id IS NOT NULL" in migration


def test_only_professional_or_written_provider_receipts_open_load_bearing_gates() -> None:
    source = (ROOT / "src" / "authority.ts").read_text()
    assert 'BROKER_NOT_SELLER: ["PROFESSIONAL_LEGAL_MEMO"]' in source
    assert 'GST_TAX: ["PROFESSIONAL_TAX_MEMO"]' in source
    assert 'SETTLEMENT_USE_CASE: ["PROVIDER_WRITTEN_APPROVAL"]' in source
    assert '"MARKETING_PAGE"' in source
    assert '"PROVIDER_PUBLIC_DOCUMENTATION"' in source
