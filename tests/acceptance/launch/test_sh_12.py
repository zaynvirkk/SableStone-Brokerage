"""Shared stock/demand allocation integration cases."""
import json, os, shutil, subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[3]
ARTIFACTS = ROOT / "artifacts" / "launch" / "SH-12"

def _artifact(name, **values):
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    (ARTIFACTS / f"{name}.json").write_text(json.dumps({"acceptance_id": name, "live_effects": 0, **values}, sort_keys=True) + "\n")

def _url():
    value = os.environ.get("LAUNCH_TEST_DATABASE_URL")
    if not value: pytest.skip("LAUNCH_TEST_DATABASE_URL is required")
    if not value.startswith("postgresql://") or ("127.0.0.1" not in value and "[::1]" not in value): pytest.fail("loopback disposable database required")
    return value

def _run(url, mode):
    node = shutil.which("node"); assert node
    result = subprocess.run([node, "--input-type=module", "-e", f"""
import {{randomUUID}} from 'node:crypto'; import {{createDatabasePool}} from './dist/runtime/database.js'; import {{inTransaction}} from './dist/runtime/database.js'; import {{reserveInventory}} from './dist/runtime/inventory_allocations.js'; import {{decimal}} from './dist/money.js';
const p=createDatabasePool({{connectionString:process.env.LAUNCH_TEST_DATABASE_URL,applicationName:'sh12',maxConnections:3,ssl:'DISABLE'}}); const s=randomUUID(),b=randomUUID(),o=randomUUID(),d=randomUUID(),t1=randomUUID(),t2=randomUUID(),m1=randomUUID(),m2=randomUUID(),source=randomUUID();
await p.query("insert into organizations(id,organization_type,legal_name_ciphertext) values($1,'SUPPLIER',decode('00','hex')),($2,'BUYER',decode('00','hex'))",[s,b]); await p.query("insert into supplier_offers(id,version,supplier_id,source_event_id,product_family,product_spec,quantity_mt,moq_mt,supplier_net,currency,expires_at,verification,freshness) values($1,1,$2,$3,'RPP_NATURAL_LIGHT_INJECTION','{{}}',100,1,78,'INR',now()+interval '1 day','VERIFIED','CURRENT')",[o,s,source]); await p.query("insert into buyer_demands(id,version,buyer_id,source_event_id,product_family,product_spec,quantity_mt,buyer_ceiling,ceiling_state,currency,standing,expires_at,verification,freshness) values($1,1,$2,$3,'RPP_NATURAL_LIGHT_INJECTION','{{}}',100,100,'KNOWN','INR',false,now()+interval '1 day','VERIFIED','CURRENT')",[d,b,source]); await p.query("insert into matches(id,offer_id,offer_version,demand_id,demand_version,compatible,rejection_reasons,matcher_version,context_digest,evaluated_at) values($1,$2,1,$3,1,true,'[]','sh12',repeat('a',64),now()),($4,$2,1,$3,1,true,'[]','sh12',repeat('b',64),now())",[m1,o,d,m2]); await p.query("insert into trades(id,match_id,supplier_id,buyer_id,state,geography,relationship_maturity,has_documentary_lc) values($1,$2,$3,$4,'PROTECTED','DOMESTIC_INDIA','NEW',false),($5,$6,$3,$4,'PROTECTED','DOMESTIC_INDIA','NEW',false)",[t1,m1,s,b,t2,m2]);
let rejected=false; await inTransaction(p,async c=>reserveInventory(c,{{offerId:o,offerVersion:1,demandId:d,demandVersion:1,tradeId:t1,quantityMt:decimal('{ '60' if mode != 'idempotent' else '60' }')}}));
try {{ await inTransaction(p,async c=>reserveInventory(c,{{offerId:o,offerVersion:1,demandId:d,demandVersion:1,tradeId:t2,quantityMt:decimal('50')}})); }} catch {{ rejected=true; }}
if ('{mode}'==='idempotent') await inTransaction(p,async c=>reserveInventory(c,{{offerId:o,offerVersion:1,demandId:d,demandVersion:1,tradeId:t1,quantityMt:decimal('60')}}));
const row=(await p.query("select coalesce(sum(quantity_mt),0)::text quantity,count(*)::int allocations from offer_inventory_allocations where offer_id=$1",[o])).rows[0]; await p.query("delete from offer_inventory_allocations where offer_id=$1",[o]); await p.query("delete from demand_inventory_allocations where demand_id=$1",[d]); await p.query("delete from trades where id in($1,$2)",[t1,t2]); await p.query("delete from supplier_offers where id=$1",[o]); await p.query("delete from buyer_demands where id=$1",[d]); await p.query("delete from organizations where id in($1,$2)",[s,b]); console.log(JSON.stringify({{rejected,row}})); await p.end();
"""], cwd=ROOT, env={**os.environ, "LAUNCH_TEST_DATABASE_URL": url}, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])

def test_reserve_shared_stock_and_demand_atomically():
    data = _run(_url(), "normal"); assert data["rejected"] and data["row"]["quantity"] == "60"; _artifact("SH12-POSITIVE", **data)

def test_reject_overlapping_stock_commitment():
    data = _run(_url(), "normal"); assert data["rejected"]; _artifact("SH12-NEGATIVE", **data)

def test_repeat_reservation_is_idempotent():
    data = _run(_url(), "idempotent"); assert data["row"]["allocations"] == 1; _artifact("SH12-RECOVERY", **data)
