import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def run(*a): return subprocess.run(a,cwd=ROOT,text=True,capture_output=True,check=False)
def test_escrow_broker_privacy_fee_and_webhooks():
    b=run("tsc","-p","tsconfig.json"); assert b.returncode==0,b.stdout+b.stderr
    r=run("node","scripts/escrow-contract.mjs"); assert r.returncode==0,r.stdout+r.stderr
    for c in ("broker_role=true","separate_fee=true","privacy=true","allocation_exact=true","webhook_idempotent=true","signature_required=true","conflict_rejected=true"): assert c in r.stdout
def test_settlement_storage_has_exact_allocations_and_unique_events():
    m=(ROOT/"migrations/0018_settlement_instructions.sql").read_text()
    assert "sablestone_entitlement numeric NOT NULL CHECK (sablestone_entitlement > 0)" in m
    assert "PRIMARY KEY(provider, external_event_id)" in m
    assert "idempotency_key text NOT NULL UNIQUE" in m
