import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]

def test_canonical_probability_model_and_realized_commission():
    build=subprocess.run(["npm","run","build"],cwd=ROOT,text=True,capture_output=True)
    assert build.returncode==0,build.stdout+build.stderr
    result=subprocess.run(["node","scripts/optimizer-contract.mjs"],cwd=ROOT,text=True,capture_output=True)
    assert result.returncode==0,result.stdout+result.stderr
    priority=(ROOT/"src/runtime/opportunity_priority.ts").read_text()
    assert "coalesce(fe.realized_commission_per_kg,pd.commission_per_kg)" in priority
    assert "settlementGivenFundedProbability" in priority
    assert "expectedRelationshipValue" not in priority
    assert "outcomes >= 30" not in priority

def test_verified_geography_hierarchy_and_prequote_ev_drive_paid_work():
    priority=(ROOT/"src/runtime/opportunity_priority.ts").read_text()
    stage=(ROOT/"src/runtime/stage_handlers.ts").read_text()
    economics=(ROOT/"src/runtime/economic_jobs.ts").read_text()
    for scope in ("GLOBAL","COUNTRY","POLYMER","APPLICATION","BUYER","SUPPLIER","PAIR"):
        assert scope in priority
    assert "organization_jurisdictions" in priority
    assert "left join trades t on t.match_id=m.id" not in priority
    assert "preQuotePriority" in stage
    assert "segment-close" in stage and "segment-settlement" in stage
    assert "order by m.priority_score desc" in economics
    assert "fulfillment_measurements" in priority

def test_advanced_waterfalls_remain_fail_closed_without_provider_builder():
    economics=(ROOT/"src/runtime/economic_jobs.ts").read_text()
    assert 'value !== "BROKER_FEE_SPLIT"' in economics
    assert "reject it before pricing/negotiation" in economics
