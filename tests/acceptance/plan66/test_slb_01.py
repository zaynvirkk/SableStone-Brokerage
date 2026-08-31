import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_typescript_platform_builds_without_network() -> None:
    result = subprocess.run(
        ["tsc", "-p", "tsconfig.json", "--noEmit"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_platform_contract_and_pinned_local_topology() -> None:
    package = json.loads((ROOT / "package.json").read_text())
    tsconfig = json.loads((ROOT / "tsconfig.json").read_text())
    compose = (ROOT / "compose.yaml").read_text()
    architecture = (ROOT / "docs" / "ARCHITECTURE.md").read_text()

    assert package["private"] is True
    assert package["engines"]["node"] == ">=22"
    assert tsconfig["compilerOptions"]["strict"] is True
    assert tsconfig["compilerOptions"]["noUncheckedIndexedAccess"] is True
    for service in ("postgres:", "redis:", "temporal:", "object-storage:"):
        assert service in compose
    assert "Redis loss cannot lose or approve a trade" in architecture


def test_live_flags_cannot_be_enabled_by_environment() -> None:
    source = (ROOT / "src" / "config.ts").read_text()
    assert "liveTrading: false" in source
    assert "liveOutreach: false" in source
    assert "liveSettlement: false" in source
    assert "productionProviders: false" in source
    assert "process.env" not in source
    assert 'automatic build cannot enable live capabilities' in source


def test_money_api_forbids_binary_numbers() -> None:
    money = (ROOT / "src" / "money.ts").read_text()
    assert "DecimalString" in money
    assert 'typeof value !== "string"' in money
    assert "number &" not in money
    assert not re.search(r"(?:price|amount|money):\s*number", money, re.I)


def test_migration_has_reversible_durable_spine() -> None:
    up = (ROOT / "migrations" / "0001_platform.sql").read_text()
    down = (ROOT / "migrations" / "0001_platform.down.sql").read_text()
    assert "PRIMARY KEY (provider, external_event_id)" in up
    assert "transactional_outbox" in up
    assert "BEGIN;" in up and "COMMIT;" in up
    assert "DROP TABLE IF EXISTS transactional_outbox" in down
    assert "DROP TABLE IF EXISTS durable_inbox" in down
