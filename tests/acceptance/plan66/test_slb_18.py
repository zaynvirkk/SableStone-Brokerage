import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
def run(*args: str): return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)
def test_settlement_sdk_requires_current_approval_credentials_and_capabilities() -> None:
    build = run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = run("node", "scripts/settlement-capability-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in ("missing_approval=unavailable", "missing_credentials=unavailable", "under_review=blocked", "public_docs=not_approval", "capabilities_exact=true"):
        assert claim in result.stdout
def test_provider_approval_and_capability_history_is_append_only() -> None:
    migration = (ROOT / "migrations" / "0017_settlement_capabilities.sql").read_text()
    assert "written_approval_receipt_id uuid NOT NULL REFERENCES authority_receipts" in migration
    assert "actual_use_case text NOT NULL" in migration
    assert "provider_approvals_no_update_delete" in migration
    assert "environment IN ('SANDBOX','PRODUCTION')" in migration
