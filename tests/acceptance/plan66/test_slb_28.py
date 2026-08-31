import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def run(*a):return subprocess.run(a,cwd=ROOT,text=True,capture_output=True,check=False)
def test_acquisition_value_and_safe_scheduling():
 b=run("tsc","-p","tsconfig.json");assert b.returncode==0,b.stdout+b.stderr
 r=run("node","scripts/acquisition-contract.mjs");assert r.returncode==0,r.stdout+r.stderr
 for c in ("ev=2000","calibrated=true","small_sample=uncalibrated","missing_outcome=unknown","missing_receipt=unknown","executable_inventory=required","stale_offer=excluded","no_send=true"):assert c in r.stdout
def test_acquisition_storage_cannot_claim_send_or_value_without_evidence():
 m=(ROOT/"migrations/0023_acquisition.sql").read_text();assert "mode='SANDBOX_PLAN_ONLY'" in m;assert "outcome_receipt_id uuid" in m;assert "state='CALIBRATED' AND value IS NOT NULL" in m
