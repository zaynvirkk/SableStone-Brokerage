import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]

def test_reviewed_agreement_registry_binds_exact_legal_receipt_and_resource():
    build=subprocess.run(["npm","run","build"],cwd=ROOT,text=True,capture_output=True)
    assert build.returncode==0,build.stdout+build.stderr
    result=subprocess.run(["node","scripts/agreement-registry-contract.mjs"],cwd=ROOT,text=True,capture_output=True)
    assert result.returncode==0,result.stdout+result.stderr
    assert "changed=4 rejected=5" in result.stdout
    source=(ROOT/"src/runtime/agreement_registry.ts").read_text()
    for requirement in (
        "authority_kind='LEGAL_AGREEMENT_APPROVAL'",
        "this.store.readVerified",
        "AGREEMENT_BINDING_SHA256:",
        "legal receipt does not approve exact agreement binding",
        "agreement version conflict",
        "agreement resource ownership mismatch",
        "AGREEMENT_RESOURCE_BOUND",
    ):
        assert requirement in source

def test_agreement_provisioning_is_system_only_and_trading_gated():
    api=(ROOT/"src/api/server.ts").read_text()
    route=api[api.index('"/v1/system/agreements"'):api.index('"/v1/system/provider-party-accounts"')]
    assert 'allowedRoles: ["SYSTEM"]' in route
    assert 'capabilities.includes("TRADING")' in route
    assert "agreementRegistry.register" in route
    assert "AGREEMENT_REGISTRATION_REJECTED" in route

def test_each_binding_has_its_own_current_exact_legal_approval():
    migration=(ROOT/"migrations/0048_binding_legal_approval.sql").read_text()
    registry=(ROOT/"src/runtime/agreement_registry.ts").read_text()
    commands=(ROOT/"src/runtime/commands.ts").read_text()
    assert "legal_gate_receipt_id uuid references authority_receipts" in migration
    assert "legacy agreement bindings require exact receipt-backed legal approval migration" in migration
    assert "binding_sha256,legal_gate_receipt_id" in registry.replace(" ","")
    assert "priorBinding.legal_gate_receipt_id !== input.legalGateReceiptId" in registry
    assert "legal.receipt_id=b.legal_gate_receipt_id" in commands
