import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
def run(*args: str): return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)
def test_bounded_negotiation_never_changes_load_bearing_policy() -> None:
    build = run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = run("node", "scripts/negotiation-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in ("bounded_accept=82.5", "below_floor=counter", "stale=decline", "credit=decline", "contract=decline", "waiver=decline", "expired=expire", "versions_bound=true"):
        assert claim in result.stdout
def test_negotiation_decisions_are_idempotent_and_policy_bound() -> None:
    migration = (ROOT / "migrations" / "0013_negotiations.sql").read_text()
    assert "pricing_policy_version text NOT NULL" in migration
    assert "FOREIGN KEY(pricing_policy_id, pricing_policy_version)" in migration
    assert "UNIQUE(negotiation_id, session_revision, intent_digest)" in migration
    assert "current_quote_per_kg numeric" in migration and "double precision" not in migration
