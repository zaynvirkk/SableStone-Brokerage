import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def run(*a):return subprocess.run(a,cwd=ROOT,text=True,capture_output=True,check=False)
def test_double_entry_invoice_tax_and_bank_reconciliation():
 b=run("tsc","-p","tsconfig.json");assert b.returncode==0,b.stdout+b.stderr
 r=run("node","scripts/ledger-contract.mjs");assert r.returncode==0,r.stdout+r.stderr
 for c in ("service_invoice=true","material_invoice=false","balanced=true","decimal=true","provider_not_bank=true","partial=true","reconciled=true","currency_netting=reject","tax_gate=required"):assert c in r.stdout
def test_ledger_is_append_only_and_never_material_invoice():
 m=(ROOT/"migrations/0021_ledger.sql").read_text();assert "invoice_kind='BROKERAGE_SERVICE'" in m;assert "material_invoice=false" in m;assert "ledger_entries_no_update_delete" in m;assert "numeric" in m and "double precision" not in m
