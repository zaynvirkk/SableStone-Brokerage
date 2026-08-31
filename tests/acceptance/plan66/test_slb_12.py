import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
def run(*args: str): return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)
def test_firm_current_complete_cost_floor_only() -> None:
    build = run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = run("node", "scripts/cost-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in ("floor=80.5", "estimate=unknown", "stale=unknown", "missing=unknown", "currency_exact=true", "decimal=true"):
        assert claim in result.stdout
def test_cost_storage_distinguishes_estimate_unknown_and_firm() -> None:
    migration = (ROOT / "migrations" / "0011_costs.sql").read_text()
    assert "('FIRM','ESTIMATE','UNKNOWN')" in migration
    assert "amount_per_kg numeric" in migration and "double precision" not in migration
    assert "UNIQUE(match_id, cost_kind)" in migration
    assert "state = 'KNOWN' AND amount_per_kg IS NOT NULL" in migration
