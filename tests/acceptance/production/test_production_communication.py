import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

def test_structured_supplier_offer_is_source_stated_and_fail_closed():
    build = subprocess.run(["npm", "run", "build"], cwd=ROOT, text=True, capture_output=True)
    assert build.returncode == 0, build.stdout + build.stderr
    result = subprocess.run(["node", "scripts/production-communication-contract.mjs"], cwd=ROOT, text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "PRODUCTION_COMMUNICATION_CONTRACT_OK" in result.stdout
