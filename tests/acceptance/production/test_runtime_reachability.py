import subprocess
from pathlib import Path

ROOT=Path(__file__).parents[3]
def test_event_processing_contract():
    build=subprocess.run(["npm","run","build"],cwd=ROOT,text=True,capture_output=True)
    assert build.returncode==0,build.stdout+build.stderr
    run=subprocess.run(["node","scripts/production-event-processing-contract.mjs"],cwd=ROOT,text=True,capture_output=True)
    assert run.returncode==0,run.stdout+run.stderr
    assert "gmail_retry=deduplicated" in run.stdout

def test_worker_reaches_real_inbox_and_discovery_handlers():
    worker=(ROOT/"scripts/start-production-worker.mjs").read_text()
    assert "buildProductionInboxHandlers" in worker
    assert "ProductionWorkflowScheduler" in worker
    assert "ProductionDiscoveryService" in worker
    assert "buildDatabaseStageHandlers(runtime.pool, adapters, discovery)" in worker
    assert "taskQueue,{}" not in worker.replace(" ","")
    migration=(ROOT/"migrations/0030_production_event_processing.sql").read_text()
    assert "settlement_provider_events" in migration
    assert "outbound_email_jobs" in migration
