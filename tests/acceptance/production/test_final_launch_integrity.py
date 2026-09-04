from pathlib import Path

ROOT=Path(__file__).parents[3]
def read(path): return (ROOT/path).read_text()

def test_required_internal_work_redrives_instead_of_terminal_failure():
    database=read("src/runtime/database.ts")
    inbox=read("src/runtime/inbox_processors.ts")
    actions=read("src/runtime/counterparty_actions.ts")
    identity=read("src/runtime/identity_provisioning.ts")
    for source in (database,inbox,actions,identity):
        assert "DEAD_LETTER_PENDING_REDRIVE" in source
        assert "next_retry_at" in source
    assert "then 'FAILED'" not in database
    assert "then 'FAILED'" not in identity

def test_identity_writes_use_one_checked_out_transaction_client():
    source=read("src/runtime/identity_provisioning.ts")
    assert "inTransaction(this.pool,async client" in source
    assert 'this.pool.query("begin")' not in source
    assert 'this.pool.query("commit")' not in source

def test_dispute_event_reaches_provider_workflow():
    supervisor=read("src/runtime/supervisor.ts")
    workflows=read("src/workflows/production.ts")
    stages=read("src/runtime/stage_handlers.ts")
    assert 'eventType==="DISPUTE_INITIATED"' in supervisor
    assert "DisputeWorkflow" in workflows
    assert "provider_dispute_reference" in stages
    assert "adapter.openDispute" in stages

def test_counterparties_have_executable_funding_dispatch_and_standing_surfaces():
    trade=read("apps/web/app/trade/[id]/page.tsx")
    assert "FundingCheckout" in trade
    assert "/shipment-events" in trade
    assert "/standing-authorization" in trade
    assert (ROOT/"apps/web/app/api/trades/[id]/shipment-events/route.ts").exists()
    assert (ROOT/"apps/web/app/api/demands/[id]/[version]/standing-authorization/route.ts").exists()

def test_release_signature_uses_pinned_external_trust_root():
    prepare=read("scripts/prepare-release.mjs")
    verify=read("scripts/verify-release.mjs")
    assert "generateKeyPairSync" not in prepare
    assert "SABLESTONE_RELEASE_SIGNING_KEY_PATH is required" in prepare
    assert "release-trust/sablestone-build.pub.pem" in prepare
    assert "release-trust/sablestone-build.pub.pem" in verify
    assert "trust root mismatch" in verify
    assert "publicKeyPem" not in read("releases/plan66-build-attestation.json")
