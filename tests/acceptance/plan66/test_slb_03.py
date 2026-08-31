import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def _run(*argv: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, cwd=ROOT, text=True, capture_output=True, check=False)


def test_lifecycle_is_deterministic_fail_closed_and_append_only() -> None:
    build = _run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = _run("node", "scripts/lifecycle-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "LIFECYCLE_OK negatives=5 idempotent=1 append_only=true" in result.stdout


def test_no_manual_or_founder_state_exists() -> None:
    source = (ROOT / "src" / "lifecycle.ts").read_text()
    migration = (ROOT / "migrations" / "0003_lifecycle.sql").read_text()
    for forbidden in ("WAITING_FOR_FOUNDER", "MANUAL", "HUMAN_REVIEW"):
        assert forbidden not in source
        assert forbidden not in migration
    assert "IDENTITY_RELEASED" in source
    assert "DISPUTED_FROZEN" in source
    assert "SETTLEMENT_FAILED" in source


def test_database_enforces_unique_and_append_only_events() -> None:
    migration = (ROOT / "migrations" / "0003_lifecycle.sql").read_text()
    down = (ROOT / "migrations" / "0003_lifecycle.down.sql").read_text()
    assert "idempotency_key text NOT NULL UNIQUE" in migration
    assert "BEFORE UPDATE OR DELETE ON domain_events" in migration
    assert "domain events are append-only" in migration
    assert "DROP TABLE IF EXISTS domain_events" in down
