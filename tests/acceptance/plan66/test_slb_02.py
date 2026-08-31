import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def _run(*argv: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, cwd=ROOT, text=True, capture_output=True, check=False)


def test_domain_behavior_and_all_product_families() -> None:
    build = _run("tsc", "-p", "tsconfig.json")
    assert build.returncode == 0, build.stdout + build.stderr
    result = _run("node", "scripts/domain-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "DOMAIN_OK families=8 negatives=5" in result.stdout


def test_domain_migration_preserves_decimal_unknown_and_versions() -> None:
    migration = (ROOT / "migrations" / "0002_domain.sql").read_text()
    down = (ROOT / "migrations" / "0002_domain.down.sql").read_text()
    assert "numeric" in migration
    assert "double precision" not in migration
    assert "real " not in migration.lower()
    assert "evidence_state AS ENUM ('KNOWN', 'UNKNOWN')" in migration
    assert migration.count("PRIMARY KEY (id, version)") == 2
    assert "CHECK (quantity_mt >= 0)" in migration
    for table in ("buyer_demands", "supplier_offers", "registrations", "documents", "organizations"):
        assert f"DROP TABLE IF EXISTS {table}" in down


def test_unknown_is_not_zero_or_empty_string() -> None:
    source = (ROOT / "src" / "domain.ts").read_text()
    assert 'state: "UNKNOWN"' in source
    assert 'state: "KNOWN"' in source
    assert "EvidenceValue" in source
    assert 'value: "0"' not in source
