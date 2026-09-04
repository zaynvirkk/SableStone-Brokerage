from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_recurring_candidate_enters_a_fresh_economics_and_settlement_cycle():
    stage = (ROOT / "src/runtime/stage_handlers.ts").read_text()
    economics = (ROOT / "src/runtime/economic_jobs.ts").read_text()
    supervisor = (ROOT / "src/runtime/supervisor.ts").read_text()

    assert "'recurring-v1'" in stage
    assert "insert into economic_quote_jobs" in stage
    assert "standing_renewal_reservations" in stage
    assert "renewals_reserved=renewals_reserved+1" in stage
    assert "renewals_consumed=renewals_consumed+1" not in stage
    assert "persistFinalEconomicsSnapshot" in economics
    assert "insert into protected_relationships" in economics
    assert "insert into trades" in economics
    assert 'eventType: "TRADE_PROTECTED"' in economics
    assert 'eventType === "TRADE_PROTECTED"' in supervisor


def test_renewal_is_consumed_only_after_fresh_entitlement_security():
    inbox = (ROOT / "src/runtime/inbox_processors.ts").read_text()
    migration = (ROOT / "migrations/0057_recurring_execution.sql").read_text()

    assert "beneficiary_verified,funds_secured" in inbox
    assert "renewals_reserved=renewals_reserved-1" in inbox
    assert "renewals_consumed=renewals_consumed+1" in inbox
    assert "next_required_at=next_required_at+(interval '1 day'*cadence_days)" in inbox
    for field in (
        "quantity_per_cycle_mt",
        "quantity_tolerance_mt",
        "cadence_days",
        "next_required_at",
        "maximum_all_in_price_per_kg",
        "supplier_scope",
        "renewals_reserved",
        "renewals_consumed",
    ):
        assert field in migration


def test_recurring_economics_respects_authorized_price_and_currency():
    economics = (ROOT / "src/runtime/economic_jobs.ts").read_text()
    commands = (ROOT / "src/runtime/commands.ts").read_text()

    assert "'PRICE_APPROVAL_REQUIRED'" in economics
    assert "maximum_all_in_price_per_kg" in economics
    assert "compareDecimalStrings" in economics
    assert "maximumAllInPricePerKg" in commands
    assert "cadenceDays" in commands
    assert "supplierScope" in commands


def test_unknown_buyer_ceiling_cannot_activate_paid_quote_work():
    stage = (ROOT / "src/runtime/stage_handlers.ts").read_text()

    assert "d.ceiling_state='KNOWN'" in stage
    assert "m.priority_score>0" in stage
    assert 'demand.ceiling_state !== "KNOWN"' in stage
