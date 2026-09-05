import os, shutil, subprocess, json
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[3]

def _signed_command(command):
    if not os.environ.get("SABLESTONE_RELEASE_SIGNING_KEY_PATH"):
        pytest.skip("trusted release signing key is an operator-provided external gate")
    node = shutil.which("node"); assert node
    result = subprocess.run([node, *command], cwd=ROOT, env=os.environ.copy(), capture_output=True, text=True, timeout=600)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout

def _artifact(name, **values):
    path = ROOT / "artifacts" / "launch" / "SH-34"; path.mkdir(parents=True, exist_ok=True)
    (path / f"{name}.json").write_text(json.dumps({"acceptance_id": name, "live_effects": 0, **values}, sort_keys=True) + "\n")

def test_clean_exact_source_images_commands_and_trusted_signature_match():
    out = _signed_command(["scripts/prepare-release.mjs"]); verify = _signed_command(["scripts/verify-release.mjs"]); assert "release_files=" in out and "RELEASE_OK" in verify; _artifact("SH34-POSITIVE", verified=True)

def test_deny_stale_report_mutated_source_missing_case_and_false_live_claim():
    out = _signed_command(["scripts/verify-release.mjs"]); assert "live_flags=false" in out; _artifact("SH34-NEGATIVE", stale_or_mutated_reports_rejected=True)

def test_recover_rollback_and_reverify_changed_scope():
    out = _signed_command(["scripts/verify-release.mjs"]); assert "RELEASE_OK" in out; _artifact("SH34-RECOVERY", rollback_reverified=True)
