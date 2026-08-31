import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
def run(*args: str): return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)
def test_versioned_agreements_and_attributed_acceptance() -> None:
    build = run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = run("node", "scripts/agreement-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in ("replay=idempotent", "altered_hash=reject", "wrong_party=reject", "otp=reject", "expired=reject", "replay_conflict=reject", "legal_gate=required", "roles_fixed=true"):
        assert claim in result.stdout
def test_acceptance_history_and_roles_are_database_enforced() -> None:
    migration = (ROOT / "migrations" / "0015_agreements.sql").read_text()
    assert "seller_of_record = 'SUPPLIER'" in migration
    assert "sablestone_role = 'COMMISSION_BROKER'" in migration
    assert "expected_organization_id = signer_organization_id" in migration
    assert "agreement_acceptances_no_update_delete" in migration
