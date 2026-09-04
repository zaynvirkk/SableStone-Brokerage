from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_recurring_candidate_enters_a_fresh_economics_and_settlement_cycle():
    stage = (ROOT / "src/runtime/stage_handlers.ts").read_text()
    economics = (ROOT / "src/runtime/economic_jobs.ts").read_text()
    execution = (ROOT / "src/runtime/recurring_execution.ts").read_text()
    supervisor = (ROOT / "src/runtime/supervisor.ts").read_text()

    assert "'recurring-v1'" in stage
    assert "insert into economic_quote_jobs" in stage
    assert "standing_renewal_reservations" in stage
    assert "renewals_reserved=renewals_reserved+1" in stage
    assert "renewals_consumed=renewals_consumed+1" not in stage
    assert "persistFinalEconomicsSnapshot" in economics
    assert "protectApprovedRecurringMatch" in economics
    assert "insert into protected_relationships" in execution
    assert "insert into trades" in execution
    assert 'eventType:"TRADE_PROTECTED"' in execution
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


def test_sixty_day_and_yearly_cadences_use_a_durable_due_date_timer():
    workflow = (ROOT / "src/workflows/production.ts").read_text()
    stage = (ROOT / "src/runtime/stage_handlers.ts").read_text()

    assert "recurrenceSchedule" in workflow
    assert "Date.parse(nextRequiredAt)-Date.now()" in workflow
    assert "await sleep(delay)" in workflow
    assert "attempt<30" not in workflow[workflow.index("const schedule=await activities.recurrenceSchedule"):]
    assert "while(Date.now()<Date.parse(validUntil))" in workflow
    assert "RECURRENCE_SCHEDULE" in stage
    assert "a.next_required_at" in stage


def test_above_ceiling_acceptance_keeps_candidate_and_reservation_linkage():
    economics = (ROOT / "src/runtime/economic_jobs.ts").read_text()
    inbox = (ROOT / "src/runtime/inbox_processors.ts").read_text()
    migration = (ROOT / "migrations/0058_recurring_mandate_and_approval.sql").read_text()

    assert "recurring_candidate_id" in migration
    assert "recurring?.candidate_id??null" in economics
    assert "PRICE_APPROVAL_REQUIRED" in economics
    assert "PRICE_APPROVED" in inbox
    assert "protectApprovedRecurringMatch(pool,client,row.match_id,row.recurring_candidate_id)" in inbox
    assert "c.trade_id=$1" in inbox


def test_declined_or_expired_recurring_approval_releases_reservation():
    inbox = (ROOT / "src/runtime/inbox_processors.ts").read_text()
    execution = (ROOT / "src/runtime/recurring_execution.ts").read_text()
    stage = (ROOT / "src/runtime/stage_handlers.ts").read_text()

    assert "releaseRecurringReservation" in inbox
    assert 'decision.action === "DECLINE"' in inbox
    assert "set state='RELEASED'" in execution
    assert "renewals_reserved=greatest(renewals_reserved-1,0)" in execution
    assert 'releaseRecurringReservation(client,expired.recurring_candidate_id,"EXPIRED")' in stage


def test_reservation_expiry_is_recoverable_and_does_not_consume_cycle():
    stage = (ROOT / "src/runtime/stage_handlers.ts").read_text()

    assert "expires_at<=now()" in stage
    assert "state='RELEASED'" in stage
    assert "renewals_reserved=greatest" in stage
    expiry_section = stage[stage.index("with expired as"):stage.index("const prior =")]
    assert "renewals_consumed" not in expiry_section


def test_standing_mandate_generates_fresh_demand_after_source_rfq_expiry():
    migration = (ROOT / "migrations/0058_recurring_mandate_and_approval.sql").read_text()
    commands = (ROOT / "src/runtime/commands.ts").read_text()
    stage = (ROOT / "src/runtime/stage_handlers.ts").read_text()

    for field in ("buyer_id", "product_family", "product_spec"):
        assert field in migration
    assert "demand.product_family" in commands and "demand.product_spec" in commands
    assert "STANDING_DEMAND_CYCLE_CREATED" in stage
    assert "insert into buyer_demands" in stage
    assert "executionDemandId" in stage
    assert "authorization.product_spec" in stage
