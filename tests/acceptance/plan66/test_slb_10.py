import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
def run(*args: str): return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)
def test_buyer_qualification_fails_closed() -> None:
    assert run("tsc", "-p", "tsconfig.json").returncode == 0
    result = run("node", "scripts/buyer-contract.mjs")
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in ("credit=fail", "stale_ceiling=fail", "prohibited_use=fail", "unknown_cadence=fail"):
        assert claim in result.stdout
def test_buyer_policy_has_no_founder_escalation() -> None:
    source = (ROOT / "src" / "qualification.ts").read_text()
    assert "SABLESTONE_CREDIT_FORBIDDEN" in source
    assert "BUYER_CEILING_NOT_CONFIRMED" in source
    assert "STANDING_CADENCE_UNKNOWN" in source
    assert "FOUNDER" not in source and "MANUAL" not in source
