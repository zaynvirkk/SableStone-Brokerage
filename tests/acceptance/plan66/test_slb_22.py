import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def run(*a): return subprocess.run(a,cwd=ROOT,text=True,capture_output=True,check=False)
def test_razorpay_route_is_prebuilt_but_eligibility_gated():
    b=run("tsc","-p","tsconfig.json"); assert b.returncode==0,b.stdout+b.stderr
    r=run("node","scripts/razorpay-contract.mjs"); assert r.returncode==0,r.stdout+r.stderr
    for c in ("ineligible=blocked","under_review=blocked","missing_receipt=blocked","eligible_fixture=true","identity_release_not_implied=true"): assert c in r.stdout
def test_razorpay_has_no_turnover_guess():
    s=(ROOT/"src/settlement_adapters.ts").read_text(); assert "eligibilityReceiptId" in s and "turnover" not in s.lower()
