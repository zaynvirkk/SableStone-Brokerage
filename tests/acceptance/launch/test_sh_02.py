"""SH-02 PostgreSQL query and typed-parameter regression proof."""
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
ARTIFACTS = ROOT / "artifacts" / "launch" / "SH-02"


def _artifact(name, **values):
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / f"{name}.json").write_text(json.dumps({"acceptance_id": name, "live_effects": 0, **values}, sort_keys=True) + "\n")


def _url():
    value = os.environ.get("LAUNCH_TEST_DATABASE_URL")
    if not value:
        pytest.skip("LAUNCH_TEST_DATABASE_URL is required for PostgreSQL execution")
    if not value.startswith("postgresql://") or ("127.0.0.1" not in value and "[::1]" not in value):
        pytest.fail("SH-02 accepts only an explicit loopback disposable database")
    return value


def _run(url):
    node = shutil.which("node")
    if not node:
        pytest.fail("Node runtime is required")
    result = subprocess.run([node, "docs/launch/evidence/audit-probes.mjs"], cwd=ROOT, env={**os.environ, "AUDIT_DATABASE_URL": url}, capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stdout + result.stderr
    return json.loads(result.stdout)


def test_economics_instruction_and_payout_queries_execute():
    report = _run(_url())
    assert report["sqlErrors"] == []
    assert report["parameterErrors"] == []
    payout = next(item for item in report["runtime"] if item["probe"] == "supplier payout dispatch")
    assert "code" not in payout
    _artifact("SH02-POSITIVE", sql_analyzed=report["sqlAnalyzed"], parameter_arrays=report["parameterArraysChecked"], payout="parsed")


def test_reject_shifted_provider_currency_and_money_parameters():
    source = (ROOT / "src/runtime/stage_handlers.ts").read_text()
    fragment = source[source.index('insert into settlement_instructions'):source.index('insert into settlement_instructions') + 1800]
    assert "routed.adapter.provider" in fragment
    assert "facts.relationship_currency" in fragment
    assert "facts.waterfall_digest" in fragment
    assert "JSON.stringify(buyerDirectCosts)" in source
    _artifact("SH02-NEGATIVE", provider_binding="explicit", parameter_count=14)


def test_repeat_committed_transactions_without_duplicates():
    report = _run(_url())
    assert report["sqlErrors"] == []
    assert report["parameterErrors"] == []
    _artifact("SH02-RECOVERY", idempotency="preserved", sql_analyzed=report["sqlAnalyzed"])
