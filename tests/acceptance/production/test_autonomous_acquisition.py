import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def test_first_outbound_and_evidence_bound_ai_translation():
    build=subprocess.run(["npm","run","build"],cwd=ROOT,text=True,capture_output=True);assert build.returncode==0,build.stdout+build.stderr
    result=subprocess.run(["node","scripts/commercial-extraction-contract.mjs"],cwd=ROOT,text=True,capture_output=True);assert result.returncode==0,result.stdout+result.stderr
    for claim in ("messy_language=source_cited","uncertain=unknown","prompt_injection=blocked","policy=deterministic"):assert claim in result.stdout
    enrichment=(ROOT/"src/runtime/enrichment_jobs.ts").read_text();worker=(ROOT/"scripts/start-production-worker.mjs").read_text();outreach=(ROOT/"src/runtime/acquisition_outreach.ts").read_text()
    assert "acquisition_outreach_jobs" in enrichment and "AcquisitionOutreachDispatcher" in worker
    for gate in ("WAITING_CONTACT","WAITING_RISK","WAITING_PROFILE","WAITING_INVENTORY","TerminalSuppression","outbound_email_jobs"):assert gate in outreach
    assert "unavailable|unsupported" not in outreach
    assert "Available: ${lane.quantity_mt} MT" in outreach
    assert "SABLESTONE_COMMERCIAL_EXTRACTOR_JSON" in worker


def test_reviewed_brave_search_reaches_durable_discovery_fail_closed():
    build = subprocess.run(
        ["npm", "run", "build"], cwd=ROOT, text=True, capture_output=True
    )
    assert build.returncode == 0, build.stdout + build.stderr
    result = subprocess.run(
        ["node", "scripts/production-search-contract.mjs"],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in (
        "evidence=preserved",
        "authority=per_use",
        "credential=per_use",
        "fail_closed=true",
    ):
        assert claim in result.stdout
    worker = (ROOT / "scripts/start-production-worker.mjs").read_text()
    service = (ROOT / "src/runtime/discovery_service.ts").read_text()
    for claim in ("buildBraveSearchConnector", "SABLESTONE_SEARCH_JSON"):
        assert claim in worker
    for claim in (
        'source.source_kind === "SEARCH"',
        "runBraveSearch",
        "discovery_receipts",
        "enrichment_jobs",
        "acquisition_profiles",
        "enqueueKyb",
        "organization_jurisdictions",
    ):
        assert claim in service


def test_acquisition_lanes_global_route_and_entitlement_provenance_are_structural():
    migration = (ROOT / "migrations/0052_global_acquisition_and_fee_lock_provenance.sql").read_text()
    outreach = (ROOT / "src/runtime/acquisition_outreach.ts").read_text()
    discovery = (ROOT / "src/runtime/discovery_service.ts").read_text()
    stages = (ROOT / "src/runtime/stage_handlers.ts").read_text()
    events = (ROOT / "src/runtime/inbox_processors.ts").read_text()
    documents = (ROOT / "src/runtime/document_jobs.ts").read_text()
    worker = (ROOT / "scripts/start-production-worker.mjs").read_text()
    for state in (
        "WAITING_CONTACT",
        "WAITING_RISK",
        "WAITING_PROFILE",
        "WAITING_INVENTORY",
    ):
        assert state in migration and state in outreach
    assert "unique(organization_id,target_product_family,application)" in migration
    assert "on conflict(organization_id,target_product_family,application)" in discovery
    assert "'IN','PENDING'" not in discovery
    assert "source.country_code" in discovery
    assert "organization_jurisdictions" in discovery and "organization_jurisdictions" in stages
    assert "documentary_lc_route_evidence" in stages
    assert "DOCUMENTARY_LC" in documents
    assert "source_communication_id" in documents
    assert "documentary_lc_route_evidence" in documents
    assert "t.state in('SETTLED','RECURRING')" in documents
    assert "prior.state in('SETTLED','RECURRING')" in stages
    assert "'DOMESTIC_INDIA','NEW',false" not in stages
    assert "entitlement_security_event_id" in migration
    assert "entitlement_security_events e on e.id=f.entitlement_security_event_id" in stages
    assert "securityId" in events and "entitlement_security_event_id" in events
    assert 'const isolated = async (subsystem, action)' in worker
    assert 'PERIODIC_SUBSYSTEM_FAILURE' in worker
    assert 'PERIODIC_CONNECTOR_FAILURE' not in worker
