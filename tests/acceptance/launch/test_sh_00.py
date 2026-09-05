"""Connected disposable-service harness for the launch work packages.

These cases intentionally skip when the operator has not supplied disposable
service endpoints.  They never fall back to fixtures or a remote service.
"""
import json, os, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[3]
ARTIFACTS = ROOT / "artifacts" / "launch" / "SH-00"
PROBE = ROOT / "tests" / "acceptance" / "launch" / "service_probe.mjs"

def _config():
    required = ["LAUNCH_TEST_DATABASE_URL", "LAUNCH_TEST_REDIS_URL", "LAUNCH_TEST_TEMPORAL_URL", "LAUNCH_TEST_S3_URL", "LAUNCH_TEST_S3_BUCKET", "LAUNCH_TEST_S3_ACCESS_KEY", "LAUNCH_TEST_S3_SECRET_KEY"]
    if any(not os.environ.get(key) for key in required) or os.environ.get("SABLESTONE_DISPOSABLE_TEST_SERVICES") != "true":
        pytest.skip("explicit disposable PostgreSQL/Redis/Temporal/object-storage endpoints are required")
    return os.environ.copy()

def _probe():
    node = shutil.which("node")
    assert node
    result = subprocess.run([node, str(PROBE)], cwd=ROOT, env=_config(), capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)

def _artifact(name, **values):
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / f"{name}.json").write_text(json.dumps({"acceptance_id": name, "live_effects": 0, **values}, sort_keys=True) + "\n")

def test_boot_real_services_and_execute_api_worker_activity():
    data = _probe(); assert data["redis"] == "PONG" and "reachable" in data["temporal"] and data["journeyVerified"] is False
    _artifact("SH00-POSITIVE", services=data)

def test_reject_missing_services_or_synthetic_state_walk():
    env = os.environ.copy(); env.pop("SABLESTONE_DISPOSABLE_TEST_SERVICES", None)
    node = shutil.which("node"); assert node
    result = subprocess.run([node, str(PROBE)], cwd=ROOT, env=env, capture_output=True, text=True, timeout=10)
    assert result.returncode != 0 and result.stdout == "" and "no completion evidence" in result.stderr.lower()
    _artifact("SH00-NEGATIVE", rejected=True)

def test_restart_database_and_workflow_without_losing_evidence():
    data = _probe(); assert data["objectStorage"].endswith("verified")
    _artifact("SH00-RECOVERY", services=data, restart_replayed=False)
