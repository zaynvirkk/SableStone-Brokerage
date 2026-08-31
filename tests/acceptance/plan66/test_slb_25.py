import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def run(*a): return subprocess.run(a,cwd=ROOT,text=True,capture_output=True,check=False)
def test_trade_operations_preserve_broker_boundary():
 b=run("tsc","-p","tsconfig.json");assert b.returncode==0,b.stdout+b.stderr
 r=run("node","scripts/trade-contract.mjs");assert r.returncode==0,r.stdout+r.stderr
 for c in ("direct_contract=true","supplier_seller=true","external_funding=true","external_shipment=true","external_inspection=true","states=settled","principal_mutations=4"):assert c in r.stdout
def test_database_fixes_supplier_as_material_principal():
 m=(ROOT/"migrations/0020_trade_operations.sql").read_text();assert "seller_organization_id = material_invoice_issuer_id" in m;assert "seller_organization_id = quality_obligation_owner_id" in m;assert "funds_frozen_by_provider" in m
