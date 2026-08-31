import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
ROUTE=ROOT/"apps/web/app/api/agreements/[id]/[version]/bindings/[bindingId]/accept/route.ts"

def test_bound_agreement_acceptance_action_revalidates_and_advances_exact_resource():
    result=subprocess.run(["npm","--prefix","apps/web","run","build"],cwd=ROOT,text=True,capture_output=True)
    assert result.returncode==0,result.stdout+result.stderr
    route=ROUTE.read_text()
    for requirement in (
        'origin !== requestUrl.origin',
        'get("sablestone_session")',
        'new URL("/v1/agreements", base)',
        'agreement_binding_id === bindingId',
        'JSON.stringify({ agreementBindingId: bindingId })',
        '/protected-acceptance',
        '/contract-acceptance',
        'agreementAcceptanceId: acceptanceId',
    ):
        assert requirement in route
    assert "request.formData" not in route

def test_agreement_listing_exposes_only_server_derived_acceptance_status():
    api=(ROOT/"src/api/server.ts").read_text()
    register=(ROOT/"apps/web/app/agreement-register.tsx").read_text()
    assert "exists(select 1 from agreement_acceptances accepted" in api
    assert "accepted.signer_organization_id=$1" in api
    assert "agreement.accepted" in register
    assert "action_completed" in api
    assert "agreement.action_completed" in register
    assert "Resume exact bound action" in register
    assert "Accept exact bound agreement" in register

def test_settlement_instruction_action_uses_server_canonical_digest():
    api=(ROOT/"src/api/server.ts").read_text()
    route=(ROOT/"apps/web/app/api/settlement-instructions/[id]/accept/route.ts").read_text()
    trade=(ROOT/"apps/web/app/trade/[id]/page.tsx").read_text()
    assert "settlementInstructionAcceptanceDigest(instruction)" in api
    assert "settlement_instruction_acceptances" in api
    assert 'origin !== requestUrl.origin' in route
    assert 'trade.settlement?.id !== id' in route
    assert "trade.settlement.instructionDigest" in route
    assert "instructionDigest: trade.settlement.instructionDigest" in route
    assert "Accept exact settlement instruction" in trade
    assert "!trade.settlement.acceptances.includes(trade.viewerRole)" in trade
