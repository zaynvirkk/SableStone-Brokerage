import subprocess
from pathlib import Path
ROOT=Path(__file__).parents[3]
def run(*args): return subprocess.run(args,cwd=ROOT,text=True,capture_output=True,timeout=120)
def test_direct_cashfree_and_razorpay_order_responses_execute():
    build=run("npm","run","build");assert build.returncode==0,build.stdout+build.stderr
    result=run("node","scripts/provider-order-response-contract.mjs");assert result.returncode==0,result.stdout+result.stderr
    assert "PROVIDER_ORDER_RESPONSES_OK" in result.stdout
def test_checkout_uses_exact_subunit_and_handler_and_shipment_is_end_to_end():
    checkout=(ROOT/"apps/web/app/funding-checkout.tsx").read_text()
    trade=(ROOT/"apps/web/app/trade/[id]/page.tsx").read_text()
    route=(ROOT/"apps/web/app/api/trades/[id]/shipment-events/route.ts").read_text()
    assert "smallestUnit(amount,currency)" in checkout and "handler:" in checkout and "callback_url" not in checkout
    for state in ('"FUNDED"','"DISPATCHED"','"IN_TRANSIT"'): assert state in trade
    assert 'type="file"' in trade and 'name="carrierOrganizationId"' in trade
    assert 'new URL("/v1/documents",base)' in route
    assert '"DISPATCHED","IN_TRANSIT","DELIVERED"' in route
    actions=(ROOT/"src/runtime/counterparty_actions.ts").read_text()
    for action in ("SUPPLIER_UPLOAD_DISPATCH_EVIDENCE","SUPPLIER_UPLOAD_TRANSIT_EVIDENCE","SUPPLIER_UPLOAD_DELIVERY_EVIDENCE"): assert action in actions
    commands=(ROOT/"src/runtime/commands.ts").read_text()
    assert "CARRIER_PROVIDER_APPROVAL" in commands and "carrier_profiles" in commands
def test_provider_factory_requires_exact_direct_response_protocols():
    source=(ROOT/"src/runtime/provider_factory.ts").read_text()
    for token in ('responseReferenceField!=="order_id"','responseFundingTokenField!=="payment_session_id"','responseStatusField!=="order_status"','responseReferenceField!=="id"','responseStatusField!=="status"'): assert token in source
