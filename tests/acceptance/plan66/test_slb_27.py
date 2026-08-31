import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def run(*a):return subprocess.run(a,cwd=ROOT,text=True,capture_output=True,check=False)
def test_recurring_relationship_requires_fresh_inputs_and_new_fee_lock():
 b=run("tsc","-p","tsconfig.json");assert b.returncode==0,b.stdout+b.stderr
 r=run("node","scripts/recurring-contract.mjs");assert r.returncode==0,r.stdout+r.stderr
 for c in ("fresh_match=true","new_fee_lock=required","stale_offer=reject","stale_demand=reject","expired_authorization=reject","exhausted=reject","protected_tail=true","indirect_qualifies=true"):assert c in r.stdout
def test_recurring_records_bind_versions_and_prior_lock():
 m=(ROOT/"migrations/0022_recurring.sql").read_text();assert "prior_fee_lock_id uuid NOT NULL REFERENCES fee_locks" in m;assert "offer_version integer NOT NULL" in m;assert "demand_version integer NOT NULL" in m;assert "MATCHED_REQUIRES_NEW_FEE_LOCK" in m
