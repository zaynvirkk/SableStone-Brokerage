import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]

def test_explicit_waterfall_preserves_supplier_net_and_buyer_direct_costs():
    build=subprocess.run(["npm","run","build"],cwd=ROOT,text=True,capture_output=True)
    assert build.returncode==0,build.stdout+build.stderr
    result=subprocess.run(["node","scripts/waterfall-contract.mjs"],cwd=ROOT,text=True,capture_output=True)
    assert result.returncode==0,result.stdout+result.stderr
    assert "WATERFALL_OK exw_supplier=78 exw_settlement=81 buyer_direct=3.5" in result.stdout
    stage=(ROOT/"src/runtime/stage_handlers.ts").read_text()
    commands=(ROOT/"src/runtime/commands.ts").read_text()
    assert "settlement_supplier_per_kg" in stage
    assert "exact multi-beneficiary or provider-deduction rail unavailable" in stage
    for field in ("buyer_all_in_amount","buyer_direct_costs","waterfall_digest"):
        assert field in stage
        assert field in commands
    assert "economic_floor_per_kg" not in stage[stage.index("async function lockSettlement"):stage.index("async function releaseIdentity")]

def test_matcher_materializes_full_filtered_opportunity_set_and_ltv_orders_work():
    stage=(ROOT/"src/runtime/stage_handlers.ts").read_text()
    priority=(ROOT/"src/runtime/opportunity_priority.ts").read_text()
    worker=(ROOT/"scripts/start-production-worker.mjs").read_text()
    assert "limit 100" not in stage[stage.index("async function executableCounterparts"):stage.index("async function matchGates")]
    assert "executableMatches.push" in stage
    assert "matchIds: executableMatches.map" in stage
    assert "return accepted(`match:${id}`" not in stage
    for factor in ("expectedProfitPriority","closeProbability","settlementGivenFundedProbability","expectedDaysToCash","hierarchical-ev-v2"):
        assert factor in priority
    assert 'isolated("opportunity-priority"' in worker
