import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def run(*a): return subprocess.run(a,cwd=ROOT,text=True,capture_output=True,check=False)
def test_bank_instruction_requires_genuine_acknowledgement():
    b=run("tsc","-p","tsconfig.json"); assert b.returncode==0,b.stdout+b.stderr
    r=run("node","scripts/bank-escrow-contract.mjs"); assert r.returncode==0,r.stdout+r.stderr
    for c in ("generated_not_locked=true","bank_ack_required=true","signature_required=true","unknown_instruction=reject","allocation_exact=true"): assert c in r.stdout
def test_instruction_acknowledgement_is_explicit():
    s=(ROOT/"src/settlement_adapters.ts").read_text(); assert "acknowledged: false" in s and "signatureVerified" in s and "signedReceiptId" in s
