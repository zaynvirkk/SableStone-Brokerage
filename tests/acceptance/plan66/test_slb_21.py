import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def run(*a): return subprocess.run(a,cwd=ROOT,text=True,capture_output=True,check=False)
def test_cashfree_vendor_split_and_reversal_contract():
    b=run("tsc","-p","tsconfig.json"); assert b.returncode==0,b.stdout+b.stderr
    r=run("node","scripts/cashfree-contract.mjs"); assert r.returncode==0,r.stdout+r.stderr
    for c in ("vendor_kyc=required","bank_verified=required","split_exact=true","success_event=true","failure_event=true","reversal_event=true","refund_adjustment=true","signature_required=true"): assert c in r.stdout
def test_cashfree_is_provider_gated_not_generic_custody():
    s=(ROOT/"src/settlement_adapters.ts").read_text(); assert 'provider = "CASHFREE_EASY_SPLIT"' in s and "Cashfree vendor not active and verified" in s
