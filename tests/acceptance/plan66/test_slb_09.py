import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
def run(*args: str): return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)
def test_supplier_qualification_and_refresh() -> None:
    assert run("tsc", "-p", "tsconfig.json").returncode == 0
    result = run("node", "scripts/supplier-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in ("missing_coa=request", "stale_registration=fail", "prepay=fail", "refresh_versions=true", "sold_out=dead"):
        assert claim in result.stdout
def test_supplier_decisions_are_version_bound() -> None:
    migration = (ROOT / "migrations" / "0009_qualification.sql").read_text()
    assert "subject_version integer NOT NULL" in migration
    assert "UNIQUE(subject_type, subject_id, subject_version, policy_version)" in migration
    assert "source_event_id uuid NOT NULL UNIQUE" in migration
