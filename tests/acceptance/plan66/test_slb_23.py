import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def run(*a): return subprocess.run(a,cwd=ROOT,text=True,capture_output=True,check=False)
def test_lc_proceeds_requires_bank_and_law_acknowledgement():
    b=run("tsc","-p","tsconfig.json"); assert b.returncode==0,b.stdout+b.stderr
    r=run("node","scripts/lc-contract.mjs"); assert r.returncode==0,r.stdout+r.stderr
    for c in ("assignment_alone=not_locked","bank_ack=required","applicable_law=required","signature=required","partial_proceeds=true"): assert c in r.stdout
def test_lc_document_cannot_claim_fee_lock():
    s=(ROOT/"src/settlement_adapters.ts").read_text(); assert "acknowledged: false" in s and "applicableLawReviewReceiptId" in s
