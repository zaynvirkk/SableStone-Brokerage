import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)

def test_authenticated_durable_email_pipeline() -> None:
    build = run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = run("node", "scripts/email-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in ("authenticated_push=true", "history_recovered=true", "inbox_unique=true", "send_idempotent=true", "bounce_suppressed=true"):
        assert claim in result.stdout

def test_email_database_has_unique_ingress_and_outbound_keys() -> None:
    migration = (ROOT / "migrations" / "0007_email.sql").read_text()
    source = (ROOT / "src" / "email.ts").read_text()
    assert "external_event_id text NOT NULL UNIQUE" in migration
    assert "idempotency_key text PRIMARY KEY" in migration
    assert "payload_object_key text NOT NULL" in migration
    assert "unauthenticated Gmail push" in source
    assert "history response range mismatch" in source
    assert "production email transport unavailable" in source
