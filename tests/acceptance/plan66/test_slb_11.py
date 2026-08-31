import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
def run(*args: str): return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)
def test_deterministic_compatibility_and_complete_rejections() -> None:
    build = run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = run("node", "scripts/match-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in ("negatives=8", "units_exact=true", "interval_edges=true", "versions_bound=true", "reasons_complete=true"):
        assert claim in result.stdout
def test_match_rows_bind_every_input_version_and_context() -> None:
    migration = (ROOT / "migrations" / "0010_matches.sql").read_text()
    assert "offer_version integer NOT NULL" in migration
    assert "demand_version integer NOT NULL" in migration
    assert "context_digest text NOT NULL" in migration
    assert "compatible AND rejection_reasons = '[]'::jsonb" in migration
