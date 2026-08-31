import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)

def test_untrusted_content_only_creates_typed_unverified_proposals() -> None:
    build = run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = run("node", "scripts/extraction-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in ("typed_proposal=true", "verified=false", "injection_rejected=true", "malformed_unit_rejected=true", "attachment_bomb_rejected=true", "malware_rejected=true"):
        assert claim in result.stdout

def test_extraction_records_cannot_self_verify() -> None:
    migration = (ROOT / "migrations" / "0008_extraction.sql").read_text()
    source = (ROOT / "src" / "extraction.ts").read_text()
    assert "verified boolean NOT NULL DEFAULT false CHECK (verified = false)" in migration
    assert "UNIQUE(communication_id, extractor_version, source_body_sha256)" in migration
    assert "expandedBytes / attachment.compressedBytes > 20" in source
    assert 'malwareScan !== "CLEAN"' in source
    assert "instruction-like content is untrusted data" in source
