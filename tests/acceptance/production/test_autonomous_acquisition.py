import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def test_first_outbound_and_evidence_bound_ai_translation():
    build=subprocess.run(["npm","run","build"],cwd=ROOT,text=True,capture_output=True);assert build.returncode==0,build.stdout+build.stderr
    result=subprocess.run(["node","scripts/commercial-extraction-contract.mjs"],cwd=ROOT,text=True,capture_output=True);assert result.returncode==0,result.stdout+result.stderr
    for claim in ("messy_language=source_cited","uncertain=unknown","prompt_injection=blocked","policy=deterministic"):assert claim in result.stdout
    enrichment=(ROOT/"src/runtime/enrichment_jobs.ts").read_text();worker=(ROOT/"scripts/start-production-worker.mjs").read_text();outreach=(ROOT/"src/runtime/acquisition_outreach.ts").read_text()
    assert "acquisition_outreach_jobs" in enrichment and "AcquisitionOutreachDispatcher" in worker
    for gate in ("risk.state='PASS'","classification_state in('SOURCE_STATED','VERIFIED')","real compatible inventory unavailable","outbound_email_jobs"):assert gate in outreach
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
    ):
        assert claim in service
