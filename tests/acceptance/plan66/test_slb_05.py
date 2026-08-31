import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)

def test_bounded_provenance_discovery() -> None:
    build = run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = run("node", "scripts/discovery-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "DISCOVERY_OK pages=2 candidates=2 negatives=4" in result.stdout
    assert "registration_not_inferred=true" in result.stdout

def test_discovery_receipts_are_source_bound_and_deduplicated() -> None:
    migration = (ROOT / "migrations" / "0005_discovery.sql").read_text()
    source = (ROOT / "src" / "discovery.ts").read_text()
    assert "UNIQUE(canonical_url, body_sha256)" in migration
    assert "discovery_receipt_id uuid NOT NULL" in migration
    assert "bodyObjectKey" in source and "bodySha256" in source
    assert "maxPages > 100" in source
    assert "robotsAllowed" in source and "termsReviewed" in source
