import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
def run(*args):return subprocess.run(args,cwd=ROOT,text=True,capture_output=True,check=False)

def test_security_reliability_and_incident_controls():
    build=run("npm","run","build");assert build.returncode==0,build.stdout+build.stderr
    result=run("node","scripts/hardening-contract.mjs");assert result.returncode==0,result.stdout+result.stderr
    for case in ("authorization_mutation=caught","telemetry_redaction=pass","webhook_mutation=caught","restore_corruption=caught","kill_switch=caught","temporal_replay=caught","ledger_mutation=caught","settlement_signature_gate=caught","identity_gate=caught","performance_budget_ms=50"):
        assert case in result.stdout

def test_security_choke_points_survive_real_source_mutations():
    mutations=[
      ("src/security.ts",'principal.organizationId !== resource.organizationId','principal.organizationId === resource.organizationId'),
      ("src/vault.ts",'authorization.supplierAcceptanceCurrent && authorization.buyerAcceptanceCurrent','authorization.supplierAcceptanceCurrent || authorization.buyerAcceptanceCurrent'),
      ("src/ledger.ts",'compareDecimalStrings(debit,credit)!==0','compareDecimalStrings(debit,credit)===0'),
      ("src/settlement.ts",'if (!event.signatureVerified)','if (event.signatureVerified)'),
    ]
    for relative,needle,replacement in mutations:
        path=ROOT/relative;original=path.read_text();assert needle in original
        try:
            path.write_text(original.replace(needle,replacement,1))
            build=run("npm","run","build");assert build.returncode==0,build.stdout+build.stderr
            result=run("node","scripts/hardening-contract.mjs")
            assert result.returncode!=0,f"mutation survived: {relative}"
        finally:path.write_text(original)
    build=run("npm","run","build");assert build.returncode==0,build.stdout+build.stderr
