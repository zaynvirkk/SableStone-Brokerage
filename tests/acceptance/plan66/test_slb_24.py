import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def run(*a): return subprocess.run(a,cwd=ROOT,text=True,capture_output=True,check=False)
def test_fee_lock_and_identity_release_choke_point():
    b=run("tsc","-p","tsconfig.json"); assert b.returncode==0,b.stdout+b.stderr
    r=run("node","scripts/router-contract.mjs"); assert r.returncode==0,r.stdout+r.stderr
    for c in ("domestic_route=cashfree","fee_lock=true","identity_release=after_lock","mutations=7","no_rail=reject","bank_draft=not_locked","replay=idempotent"): assert c in r.stdout
def test_fee_lock_is_append_only_and_binds_exact_acceptances():
    m=(ROOT/"migrations/0019_fee_locks.sql").read_text()
    assert "instruction_digest = supplier_accepted_instruction_digest" in m
    assert "instruction_digest = buyer_accepted_instruction_digest" in m
    assert "fee_locks_no_update_delete" in m
    assert "identity_release_fee_lock_fk" in m
