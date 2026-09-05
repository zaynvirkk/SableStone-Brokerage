"""Native provider event normalization and fail-closed parsing."""
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ARTIFACTS = ROOT / "artifacts" / "launch" / "SH-04"


def _artifact(name, **values):
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / f"{name}.json").write_text(json.dumps({"acceptance_id": name, "live_effects": 0, **values}, sort_keys=True) + "\n")


def _run(script):
    node = shutil.which("node")
    assert node, "Node runtime is required"
    result = subprocess.run([node, "--input-type=module", "-e", script], cwd=ROOT, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])


def test_native_provider_events_normalize_timestamps_and_minor_units():
    data = _run("""
import {normalizeProviderOccurredAt,normalizeProviderAmount} from './dist/runtime/inbox_processors.js';
console.log(JSON.stringify({seconds:normalizeProviderOccurredAt(1788600000),milliseconds:normalizeProviderOccurredAt(1788600000000),iso:normalizeProviderOccurredAt('2026-09-05T09:20:00Z'),rupees:normalizeProviderAmount('RAZORPAY_ROUTE','INR',10000000),cashfree:normalizeProviderAmount('CASHFREE_EASY_SPLIT','INR','100000')}));
""")
    assert data["seconds"].endswith("Z") and data["milliseconds"].endswith("Z")
    assert data["rupees"] == "100000"
    assert data["cashfree"] == "100000"
    _artifact("SH04-POSITIVE", **data)


def test_reject_malformed_provider_event_values():
    node = shutil.which("node")
    assert node
    result = subprocess.run([node, "--input-type=module", "-e", """
import assert from 'node:assert/strict'; import {normalizeProviderOccurredAt,normalizeProviderAmount} from './dist/runtime/inbox_processors.js';
for (const value of [null,undefined,0,NaN,'not-a-date']) assert.throws(()=>normalizeProviderOccurredAt(value));
for (const value of [null,undefined,{},'not-a-number']) assert.throws(()=>normalizeProviderAmount('RAZORPAY_ROUTE','INR',value));
assert.throws(()=>normalizeProviderAmount('RAZORPAY_ROUTE','INR','-1'));
"""], cwd=ROOT, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    _artifact("SH04-NEGATIVE", malformed="rejected")


def test_provider_poll_recovers_native_time_without_duplicate_money_units():
    source = (ROOT / "src/runtime/inbox_processors.ts").read_text()
    assert "normalizeProviderOccurredAt" in source
    assert "normalizeProviderAmount" in source
    assert "provider === \"RAZORPAY_ROUTE\"" in source
    assert "settlement_provider_events" in source
    _artifact("SH04-RECOVERY", replay="inbox-idempotent", raw_preserved=True)
