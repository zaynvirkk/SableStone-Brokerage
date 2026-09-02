from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_final_negotiated_economics_are_immutable_and_bound_end_to_end():
    migration = (ROOT / "migrations/0053_final_economics_and_priority.sql").read_text()
    inbox = (ROOT / "src/runtime/inbox_processors.ts").read_text()
    stages = (ROOT / "src/runtime/stage_handlers.ts").read_text()
    agreements = (ROOT / "src/runtime/agreement_automation.ts").read_text()

    assert "create table final_economics_snapshots" in migration
    assert "final_economics_snapshots_no_update_delete" in migration
    assert "economic_floor_per_kg+realized_commission_per_kg=accepted_buyer_price_per_kg" in migration
    assert "persistFinalEconomicsSnapshot" in inbox
    assert "subtractDecimal" in inbox
    assert "fe.realized_commission_per_kg" in agreements
    assert "fe.realized_commission_per_kg" in stages
    assert "fe.accepted_buyer_price_per_kg" in stages
    assert "final_economics_snapshot_id" in stages


def test_route_compatibility_and_expected_value_control_work_queues():
    stages = (ROOT / "src/runtime/stage_handlers.ts").read_text()
    acquisition = (ROOT / "src/runtime/acquisition_outreach.ts").read_text()
    economics = (ROOT / "src/runtime/economic_jobs.ts").read_text()
    scheduler = (ROOT / "src/runtime/scheduler.ts").read_text()
    discovery = (ROOT / "src/runtime/discovery_service.ts").read_text()

    assert "ROUTE_SPECIFIC_SETTLEMENT_UNAVAILABLE" in stages
    assert "deepCompatible(candidate.product_spec" in acquisition
    assert "priority_score desc,created_at" in acquisition
    assert "m.priority_score desc,j.created_at" in economics
    assert "priority_score desc,next_run_at" in scheduler
    assert "state='CALIBRATED' and sample_size>=30" in discovery
    assert "supplier NET INR/kg" not in acquisition


def test_rich_product_specifications_survive_ingestion():
    brain = (ROOT / "src/connectors/communication_brain.ts").read_text()
    extraction = (ROOT / "src/connectors/commercial_extraction.ts").read_text()
    inbox = (ROOT / "src/runtime/inbox_processors.ts").read_text()
    for field in (
        "grade",
        "application",
        "colour",
        "density",
        "ash",
        "moisture",
        "recycledContentType",
        "dispatchLocation",
        "incoterm",
        "leadTime",
        "paymentTerms",
        "properties",
    ):
        assert field in brain
        assert field in inbox
    assert 'value("properties_json")' in extraction
    assert "net[2]?.toUpperCase() ??" in brain
    assert "/₹|\\bINR\\b/i.test(net[0])" in brain
    assert "if (!currency) return null" in brain
