import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]

def test_independent_document_verifier_and_provider_allowlist_fail_closed():
    build=subprocess.run(["npm","run","build"],cwd=ROOT,text=True,capture_output=True)
    assert build.returncode==0,build.stdout+build.stderr
    result=subprocess.run(["node","scripts/production-document-verifier-contract.mjs"],cwd=ROOT,text=True,capture_output=True)
    assert result.returncode==0,result.stdout+result.stderr
    assert "verified=independent" in result.stdout
    assert "self_stated=blocked" in result.stdout
    assert "unknown_rail=blocked" in result.stdout

def test_document_verification_and_qualification_are_durable_and_worker_reachable():
    migration=(ROOT/"migrations/0039_document_verification_qualification.sql").read_text()
    worker=(ROOT/"scripts/start-production-worker.mjs").read_text()
    runtime=(ROOT/"src/runtime/document_jobs.ts").read_text()
    for table in ("document_verification_jobs","document_verification_receipts"):
        assert f"create table if not exists {table}" in migration
    for symbol in ("DocumentVerificationJobDispatcher","QualificationJobDispatcher","buildProductionDocumentVerifier"):
        assert symbol in worker
    assert "OFFER_VERSION_ADDED" in runtime
    assert "DEMAND_VERSION_ADDED" in runtime
    assert "'VERIFIED'" in runtime

def test_production_specification_ranges_fail_closed():
    build=subprocess.run(["npm","run","build"],cwd=ROOT,text=True,capture_output=True)
    assert build.returncode==0,build.stdout+build.stderr
    result=subprocess.run(["node","scripts/production-spec-contract.mjs"],cwd=ROOT,text=True,capture_output=True)
    assert result.returncode==0,result.stdout+result.stderr
    assert "range=bounded" in result.stdout
    assert "unknown=blocked" in result.stdout

def test_firm_quote_and_negotiation_pipeline_is_reachable_and_fail_closed():
    build=subprocess.run(["npm","run","build"],cwd=ROOT,text=True,capture_output=True)
    assert build.returncode==0,build.stdout+build.stderr
    result=subprocess.run(["node","scripts/production-economics-contract.mjs"],cwd=ROOT,text=True,capture_output=True)
    assert result.returncode==0,result.stdout+result.stderr
    assert "firm=receipt_backed" in result.stdout
    assert "estimate=blocked" in result.stdout
    stage=(ROOT/"src/runtime/stage_handlers.ts").read_text()
    worker=(ROOT/"scripts/start-production-worker.mjs").read_text()
    supervisor=(ROOT/"src/runtime/supervisor.ts").read_text()
    assert "ensureEconomicJobs" in stage
    assert "EconomicQuoteJobDispatcher" in worker
    assert "CommercialNotificationDispatcher" in worker
    assert 'eventType === "MATCH_EXECUTABLE"' in supervisor
