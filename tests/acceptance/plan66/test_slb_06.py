import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)

def test_lawful_verified_contact_and_global_suppression() -> None:
    build = run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = run("node", "scripts/contact-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "CONTACT_OK sendable=1 negatives=6" in result.stdout
    assert "suppression_global=true suppression_idempotent=true" in result.stdout

def test_contacts_are_provenance_bound_and_suppressions_append_only() -> None:
    migration = (ROOT / "migrations" / "0006_contacts.sql").read_text()
    source = (ROOT / "src" / "contacts.ts").read_text()
    assert "source_receipt_id uuid NOT NULL REFERENCES discovery_receipts" in migration
    assert "global_suppressions_no_update_delete" in migration
    assert 'contact.source === "GUESSED"' in source
    assert 'contact.verification !== "VERIFIED"' in source
    assert "lawfulBasisPolicyVersion" in source
