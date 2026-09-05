"""Harness guard tests; deliberately not the full SH-00 acceptance cases."""
import subprocess
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_missing_services_cannot_emit_success():
    result = subprocess.run(
        [shutil.which('node'), 'tests/acceptance/launch/service_probe.mjs'],
        cwd=ROOT, env={}, capture_output=True, text=True, timeout=10,
    )
    assert result.returncode != 0
    assert result.stdout == ''
    assert 'no completion evidence emitted' in result.stderr


def test_reject_remote_services_and_live_flags_before_connecting():
    result = subprocess.run(['node', '--input-type=module', '-e', '''
import assert from 'node:assert/strict';
import {readHarnessConfig, localEndpoint} from './tests/acceptance/launch/service_probe.mjs';
for (const host of ['example.com', 'localhost', '169.254.169.254', '10.0.0.1']) {
  assert.throws(() => localEndpoint(`http://${host}:9000`, 'test', ['http:']));
}
assert.equal(localEndpoint('http://127.0.0.1:9000', 'test', ['http:']), 'http://127.0.0.1:9000');
assert.throws(() => readHarnessConfig({SABLESTONE_DISPOSABLE_TEST_SERVICES:'true', LIVE_TRADING:'true'}), /forbidden/);
assert.throws(() => readHarnessConfig({}), /acknowledgement/);
'''], cwd=ROOT, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
