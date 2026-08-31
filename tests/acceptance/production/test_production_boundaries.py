import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def run(*args):return subprocess.run(args,cwd=ROOT,text=True,capture_output=True,check=False)
def test_production_boundaries_are_real_clients_and_fail_closed():
    build=run("npm","run","build");assert build.returncode==0,build.stdout+build.stderr
    result=run("node","scripts/production-boundary-contract.mjs");assert result.returncode==0,result.stdout+result.stderr
    for claim in ("discovery_receipts=1","unreviewed_source=blocked","settlement_http=acknowledged","provider_under_review=blocked","document_state=SOURCE_STATED","gmail_mime=preserved","activation=signature_verified"):
        assert claim in result.stdout
def test_runtime_dependencies_and_durable_schema_are_present():
    package=(ROOT/"package.json").read_text()
    for dependency in ("pg","ioredis","@aws-sdk/client-s3","@temporalio/client","@temporalio/worker","googleapis","mailparser","fastify"):
        assert f'"{dependency}"' in package
    migration=(ROOT/"migrations/0025_production_runtime.sql").read_text()
    assert "create table if not exists external_event_inbox" in migration
    assert "alter table transactional_outbox add column if not exists idempotency_key" in migration
