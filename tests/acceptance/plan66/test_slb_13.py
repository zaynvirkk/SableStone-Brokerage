import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
def run(*args: str): return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)
def test_decimal_pricing_caps_floors_and_ltv_truth() -> None:
    build = run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = run("node", "scripts/pricing-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in ("surplus=8.5", "commission=3.4", "executable=83.9", "thin=rejected", "decimal_exact=true", "ltv=heuristic", "missing_ltv=unknown"):
        assert claim in result.stdout
def test_pricing_is_policy_version_and_authority_bound() -> None:
    migration = (ROOT / "migrations" / "0012_pricing.sql").read_text()
    assert "approval_receipt_id uuid NOT NULL REFERENCES authority_receipts" in migration
    assert "FOREIGN KEY(policy_id, policy_version)" in migration
    assert "evidence_state IN ('HYPOTHESIS','CALIBRATED')" in migration
    assert "numeric" in migration and "double precision" not in migration
