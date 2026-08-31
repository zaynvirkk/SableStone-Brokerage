import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
def run(*args: str): return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)
def test_kyb_sanctions_and_unknowns_fail_closed() -> None:
    build = run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = run("node", "scripts/risk-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in ("sanctions_hit=reject", "unknown=freeze", "ambiguous=freeze", "stale=freeze", "missing=freeze", "llm_override=absent"):
        assert claim in result.stdout
def test_risk_history_is_append_only_and_source_bound() -> None:
    migration = (ROOT / "migrations" / "0014_risk.sql").read_text()
    source = (ROOT / "src" / "risk.ts").read_text()
    assert "source_digest text NOT NULL" in migration
    assert "risk_checks_no_update_delete" in migration and "risk_decisions_no_update_delete" in migration
    assert "Model output is intentionally absent" in source
    assert "LLM" not in source
