import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
def run(*args: str): return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)
def test_identity_is_sealed_until_atomic_release() -> None:
    build = run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = run("node", "scripts/vault-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in ("anonymous_pre_release=true", "surfaces_redacted=5", "prerequisites=5", "atomic_release=true", "replay_idempotent=true", "conflict_rejected=true"):
        assert claim in result.stdout
def test_vault_and_release_history_are_append_only() -> None:
    migration = (ROOT / "migrations" / "0016_protected_vault.sql").read_text()
    assert "legal_name_ciphertext bytea NOT NULL" in migration
    assert "bank_details_ciphertext bytea NOT NULL" in migration
    assert "identity_release_events_no_update_delete" in migration
    assert "fee_lock_id uuid NOT NULL" in migration
    assert "supplier_id <> buyer_id" in migration
