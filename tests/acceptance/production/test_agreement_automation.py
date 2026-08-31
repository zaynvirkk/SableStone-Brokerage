import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def test_agreement_templates_render_fail_closed_without_pre_release_identities():
    build=subprocess.run(["npm","run","build"],cwd=ROOT,text=True,capture_output=True);assert build.returncode==0,build.stdout+build.stderr
    result=subprocess.run(["node","scripts/agreement-automation-contract.mjs"],cwd=ROOT,text=True,capture_output=True);assert result.returncode==0,result.stdout+result.stderr
    assert "protected_identity_sealed=true trade_identity_released=true rejected=4" in result.stdout
def test_reviewed_templates_and_dispatcher_are_production_wired():
    migration=(ROOT/"migrations/0049_agreement_templates.sql").read_text();source=(ROOT/"src/runtime/agreement_automation.ts").read_text();worker=(ROOT/"scripts/start-production-worker.mjs").read_text();api=(ROOT/"src/api/server.ts").read_text()
    assert "agreement_templates_no_update_delete" in migration
    assert "agreement_resource_binding_semantic_unique" in migration
    assert "agreement_kind,agreement_version,resource_type" in migration
    for requirement in ("LEGAL_AGREEMENT_TEMPLATE","AGREEMENT_TEMPLATE:","RENDERER_V1","this.store.preserve","registerRendered","t.state in('IDENTITY_RELEASED','CONTRACTED','FUNDED')"):
        assert requirement in source
    assert "order by calculated_at desc" in source
    assert "order by m.created_at" not in source
    assert 'if (agreementAutomation) await agreementAutomation.dispatchBatch()' in worker
    assert 'capabilities.includes("TRADING")' in worker
    segment=api[api.index('"/v1/system/agreement-templates"'):api.index('"/v1/system/agreements"')]
    assert 'allowedRoles: ["SYSTEM"]' in segment
    assert 'capabilities.includes("TRADING")' in segment
