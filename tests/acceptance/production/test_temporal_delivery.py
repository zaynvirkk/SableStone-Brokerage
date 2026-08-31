import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_temporal_delivery_replay_and_activity_binding_contract():
    build = subprocess.run(
        ["npm", "run", "build"], cwd=ROOT, text=True, capture_output=True
    )
    assert build.returncode == 0, build.stdout + build.stderr
    result = subprocess.run(
        ["node", "scripts/temporal-delivery-contract.mjs"],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert (
        "TEMPORAL_DELIVERY_OK starts=1 replay=acknowledged "
        "unrelated_error=rejected activities=bound"
    ) in result.stdout


def test_worker_uses_explicit_activity_binding_and_outbox_replay_is_success():
    worker = (ROOT / "scripts/start-production-worker.mjs").read_text()
    supervisor = (ROOT / "src/runtime/supervisor.ts").read_text()
    assert "bindBrokerageActivities(activityService)" in worker
    assert "startWorkflowIdempotently" in supervisor
    assert 'error.name === "WorkflowExecutionAlreadyStartedError"' in supervisor
    assert 'return "ALREADY_STARTED"' in supervisor
