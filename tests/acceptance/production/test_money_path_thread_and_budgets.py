from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_final_snapshot_reads_and_maps_complete_waterfall_row():
    source = (ROOT / "src/runtime/inbox_processors.ts").read_text()
    query = source[source.index("select cost_kind,amount_per_kg"):source.index("where match_id=$1 order by cost_kind for share")]
    for field in (
        "payer_role",
        "settlement_treatment",
        "beneficiary_role",
        "beneficiary_id",
    ):
        assert field in query
    assert "interface CostComponentRow" in source
    assert "components.map(mapWaterfallCost)" in source


def test_counteroffer_is_bound_to_exact_provider_thread_and_buyer():
    source = (ROOT / "src/runtime/inbox_processors.ts").read_text()
    function = source[source.index("async function applyNegotiationIntent"):source.index("const FINAL_COST_KINDS")]
    assert "providerThreadId: string" in function
    assert "j.provider_thread_id=$1" in function
    assert "n.id=$1 and d.buyer_id=$2" in function
    assert "thread binding unavailable or ambiguous" in function
    assert "order by m.priority_score" not in function
    assert "threadId: row.provider_thread_id" in source


def test_waterfall_capability_preflight_happens_before_negotiation_creation():
    economics = (ROOT / "src/runtime/economic_jobs.ts").read_text()
    preflight = economics.index("exactWaterfallRouteAvailable")
    negotiation = economics.index("insert into negotiations")
    assert preflight < negotiation
    for capability in ("MULTI_BENEFICIARY", "PROVIDER_DEDUCTION", "RESERVE_HOLD"):
        assert capability in economics
    assert "EXACT_WATERFALL_ROUTE_UNAVAILABLE" in economics


def test_candidate_sweep_is_resumable_and_quote_spend_is_hard_capped():
    stage = (ROOT / "src/runtime/stage_handlers.ts").read_text()
    supervisor = (ROOT / "src/runtime/supervisor.ts").read_text()
    economics = (ROOT / "src/runtime/economic_jobs.ts").read_text()
    migration = (ROOT / "migrations/0055_quote_spend_caps.sql").read_text()
    assert "match_candidate_sweeps" in migration
    assert "batchSize = 250" in stage
    assert "MATCH_SWEEP_CONTINUE" in stage and "MATCH_SWEEP_CONTINUE" in supervisor
    assert "`${workflow.name}:${String(event.event_id)}`" in supervisor
    assert "if (!hasContinuation)" in stage
    assert "activateEconomicJobsForSweep" in stage
    assert "economic_quote_spend_reservations" in migration
    assert "pg_advisory_xact_lock" in economics
    assert "DAILY_QUOTE_BUDGET_EXHAUSTED" in economics
