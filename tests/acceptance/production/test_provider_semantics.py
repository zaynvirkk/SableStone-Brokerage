import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def test_provider_payloads_webhooks_and_entitlement_gate():
    build=subprocess.run(["npm","run","build"],cwd=ROOT,text=True,capture_output=True)
    assert build.returncode==0,build.stdout+build.stderr
    result=subprocess.run(["node","scripts/provider-semantics-contract.mjs"],cwd=ROOT,text=True,capture_output=True)
    assert result.returncode==0,result.stdout+result.stderr
    for claim in ("escrow=separate_broker_item","escrow_webhook=fetch_confirmed","cashfree=order_capture_then_supplier_split","cashfree_reconciliation=exact","cashfree_commission=merchant_retained","razorpay=order_capture_then_integer_paise_transfer","webhooks=provider_specific","instruction_created=not_fee_locked"): assert claim in result.stdout
    stage=(ROOT/"src/runtime/stage_handlers.ts").read_text()
    assert "awaiting provider-confirmed secured funds and exact SableStone beneficiary" in stage
    assert "insert into fee_locks" not in stage[stage.index("async function lockSettlement"):stage.index("async function releaseIdentity")]
    projection=(ROOT/"src/runtime/inbox_processors.ts").read_text()
    assert 'internalType === "ENTITLEMENT_SECURED"' in projection
    assert "entitlement_security_events" in projection
    migration=(ROOT/"migrations/0043_entitlement_security.sql").read_text()
    assert "beneficiary_verified boolean not null check(beneficiary_verified)" in migration
    assert "funds_secured boolean not null check(funds_secured)" in migration
    for legacy_repair in ("add column if not exists id uuid","add column if not exists trade_id uuid","add column if not exists payload_sha256 text","legacy settlement provider events require receipt-backed migration"):
        assert legacy_repair in migration

def test_provider_party_references_are_verified_encrypted_and_bound():
    migration=(ROOT/"migrations/0045_provider_party_accounts.sql").read_text()
    source=(ROOT/"src/connectors/settlement_http.ts").read_text()
    resolver=(ROOT/"src/runtime/provider_parties.ts").read_text()
    for field in ("reference_ciphertext bytea not null","verification_receipt_id text not null","provider_buyer_party_account_id","provider_supplier_party_account_id","provider_sablestone_party_account_id"):
        assert field in migration
    assert "providerReference(draft.providerParties" in source
    assert "cashfreeSplitVerificationPathTemplate" in source
    assert "assertCashfreeSplitVerification" in source
    factory=(ROOT/"src/runtime/provider_factory.ts").read_text()
    assert "Cashfree split creation and exact verification paths required" in factory
    for unsafe in ("customer: draft.buyerId","vendor_id: draft.supplierId","account: draft.supplierId"):
        assert unsafe not in source
    assert "current verified provider party mapping missing" in resolver
