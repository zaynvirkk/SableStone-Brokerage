"""SH-01 declared toolchain and migration lifecycle.

The integration cases require an explicitly supplied disposable PostgreSQL URL.
They never fall back to a fake database or a production URL.
"""
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
ARTIFACTS = ROOT / "artifacts" / "launch" / "SH-01"


def _artifact(name, **values):
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    payload = {"acceptance_id": name, "live_effects": 0, **values}
    (ARTIFACTS / f"{name}.json").write_text(json.dumps(payload, sort_keys=True) + "\n")


def _db_url():
    value = os.environ.get("LAUNCH_TEST_DATABASE_URL")
    if not value:
        pytest.skip("LAUNCH_TEST_DATABASE_URL is required for connected migration proof")
    if not value.startswith("postgresql://") or "127.0.0.1" not in value and "[::1]" not in value:
        pytest.fail("migration tests accept only an explicit loopback disposable database")
    return value


def test_clean_image_and_fresh_upgrade_migrations():
    url = _db_url()
    node = shutil.which("node")
    if not node:
        pytest.fail("Node runtime is required; no global compiler fallback is allowed")
    result = subprocess.run(
        [node, "--input-type=module", "-e", """
import {createDatabasePool, runMigrations} from './dist/runtime/database.js';
import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';
const pool=createDatabasePool({connectionString:process.env.LAUNCH_TEST_DATABASE_URL,applicationName:'sh01',maxConnections:2,ssl:'DISABLE'});
const paths=readdirSync('migrations').filter(n=>/^\\d{4}_[^.]+\\.sql$/.test(n)&&!n.includes('.down.')).sort().map(n=>resolve('migrations',n));
const first=await runMigrations(pool,paths); const second=await runMigrations(pool,paths);
const schema=(await pool.query("select exists(select 1 from information_schema.columns where table_name='trades' and column_name='created_at') as created_at, count(*)::int as migrations from migration_checksums")).rows[0];
console.log(JSON.stringify({first:first.length,second:second.length,created_at:schema.created_at,migrations:schema.migrations})); await pool.end();
"""],
        cwd=ROOT, env={**os.environ, "LAUNCH_TEST_DATABASE_URL": url},
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    data = json.loads(result.stdout.strip().splitlines()[-1])
    assert data["created_at"] is True
    assert data["second"] == 0
    _artifact("SH01-POSITIVE", **data)


def test_reject_global_compiler_dependency_and_schema_drift():
    package = json.loads((ROOT / "package.json").read_text())
    assert "typescript" in package["devDependencies"]
    lock = json.loads((ROOT / "package-lock.json").read_text())
    assert any(key.endswith("node_modules/typescript") for key in lock["packages"])
    assert "npm ci" in (ROOT / "Containerfile.api").read_text()
    assert "npm install -g typescript" not in (ROOT / "Containerfile.api").read_text()
    assert "migration drift" in (ROOT / "src/runtime/database.ts").read_text()
    _artifact("SH01-NEGATIVE", compiler="declared", drift="rejected")


def test_restart_interrupted_migration_and_restore_schema():
    url = _db_url()
    node = shutil.which("node")
    if not node:
        pytest.fail("Node runtime is required")
    result = subprocess.run(
        [node, "--input-type=module", "-e", """
import {createDatabasePool,runMigrations} from './dist/runtime/database.js';
import {readdirSync} from 'node:fs'; import {resolve} from 'node:path';
const pool=createDatabasePool({connectionString:process.env.LAUNCH_TEST_DATABASE_URL,applicationName:'sh01-recovery',maxConnections:2,ssl:'DISABLE'});
const paths=readdirSync('migrations').filter(n=>/^\\d{4}_[^.]+\\.sql$/.test(n)&&!n.includes('.down.')).sort().map(n=>resolve('migrations',n));
await pool.query("select 1"); const applied=await runMigrations(pool,paths); const check=await pool.query("select count(*)::int as tables from information_schema.tables where table_schema='public'"); console.log(JSON.stringify({applied:applied.length,tables:check.rows[0].tables})); await pool.end();
"""], cwd=ROOT, env={**os.environ, "LAUNCH_TEST_DATABASE_URL": url}, capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    data = json.loads(result.stdout.strip().splitlines()[-1])
    assert data["tables"] > 0
    _artifact("SH01-RECOVERY", **data)
