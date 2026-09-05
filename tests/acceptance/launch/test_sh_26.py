from script_runner import run_scripts
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

def test_valid_started_work_resumes_after_prolonged_outage(): run_scripts("SH-26", ["temporal-delivery-contract.mjs", "reliability-contract.mjs"], "SH26-POSITIVE")
def test_deny_silent_terminal_failure_unbounded_spend_and_poison_starvation(): run_scripts("SH-26", ["hardening-contract.mjs", "reliability-contract.mjs", "optimizer-contract.mjs"], "SH26-NEGATIVE")
def test_recover_outbox_publish_then_workflow_failure_without_manual_restart(): run_scripts("SH-26", ["temporal-delivery-contract.mjs", "reliability-contract.mjs", "production-event-processing-contract.mjs"], "SH26-RECOVERY")

def test_workflow_activities_have_durable_unbounded_transient_retry():
    source = (ROOT / "src" / "workflows" / "production.ts").read_text()
    assert "maximumAttempts:0" in source.replace(" ", "")
    assert "scheduleToCloseTimeout:" not in source
