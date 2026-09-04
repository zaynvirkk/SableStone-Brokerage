from pathlib import Path

ROOT=Path(__file__).parents[3]

def read(path): return (ROOT/path).read_text()

def test_supplier_money_is_held_until_delivery_and_disputes_freeze_release():
    settlement=read("src/connectors/settlement_http.ts")
    dispatcher=read("src/runtime/supplier_payouts.ts")
    capability=read("src/settlement.ts")
    assert 'on_hold: true' in settlement
    assert 'payload = { on_hold: false }' in settlement
    assert 'method = "PUT"' in settlement
    assert 'settlementEligibilityDateUpdate: now' in settlement
    assert '"{order_id}"' in settlement and '"{vendor_id}"' in settlement
    assert "join delivery_acceptances" in dispatcher
    assert "counterparty_dispute_requests" in dispatcher
    assert "DELIVERY_CONDITIONAL_SUPPLIER_RELEASE" in capability

def test_money_events_dead_letter_and_autonomously_redrive():
    database=read("src/runtime/database.ts")
    migration=read("migrations/0059_launch_hardening.sql")
    assert "DEAD_LETTER_PENDING_REDRIVE" in database
    assert "next_retry_at<=now()" in database
    assert "redrive_count=redrive_count+1" in database
    assert "PERMANENT_INVALID" in database
    assert "external_event_inbox_redrive" in migration

def test_recurring_authority_commits_before_fresh_entitlement_consumes_it():
    recurring=read("src/runtime/recurring_execution.ts")
    events=read("src/runtime/inbox_processors.ts")
    assert "state='COMMITTED'" in recurring
    assert "final_economics_snapshot_id=$3" in recurring
    assert "r.state='COMMITTED'" in events
    assert "protected_transaction_terms" in recurring
    assert "supplier_acceptance_id,buyer_acceptance_id" not in recurring

def test_counterparty_actions_identity_and_security_are_production_wired():
    worker=read("scripts/start-production-worker.mjs")
    api=read("src/api/server.ts")
    webhooks=read("src/runtime/webhooks.ts")
    config=read("src/runtime/production_config.ts")
    assert "CounterpartyActionDispatcher" in worker
    assert "IdentityProvisioningDispatcher" in worker
    assert 'algorithms: [deps.jwtAlgorithm ?? "RS256"]' in api
    assert "counterparty_principals" in api
    assert "expectedServiceAccountEmail" in webhooks
    assert "SABLESTONE_OBJECT_STORAGE_OBJECT_LOCK" in config

def test_many_to_many_money_reconciliation_is_exact():
    accounting=read("src/runtime/accounting.ts")
    assert "providerRows.reduce" in accounting
    assert "allocatedBankRows.reduce" in accounting
    assert "sourceRemaining" in accounting
    assert "settlement_allocation_links where source_kind='BANK_ENTRY' and source_reference=$1" in accounting
    assert "settlement_allocation_links" in accounting
    assert 'state === "RECONCILED"' in accounting
