"""Run deterministic production-boundary contract scripts and bind artifacts."""
import json, os, shutil, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

def run_scripts(task: str, scripts: list[str], artifact: str, **extra):
    node = shutil.which("node")
    assert node, "Node.js is required"
    outputs = {}
    for script in scripts:
        # The full deterministic replay intentionally launches every contract
        # probe in isolated Node processes.  On a constrained CI/host runner
        # that replay can legitimately take longer than the old 90-second
        # ceiling even though it is making no network calls.  Keep the bound
        # finite, but give the complete offline acceptance enough headroom.
        timeout = int(os.environ.get("SABLESTONE_CONTRACT_TIMEOUT_SECONDS", "180"))
        result = subprocess.run([node, f"scripts/{script}"], cwd=ROOT, capture_output=True, text=True, timeout=timeout)
        assert result.returncode == 0, f"{script}:\n{result.stdout}\n{result.stderr}"
        outputs[script] = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""
    path = ROOT / "artifacts" / "launch" / task
    path.mkdir(parents=True, exist_ok=True)
    (path / f"{artifact}.json").write_text(json.dumps({"acceptance_id": artifact, "live_effects": 0, "scripts": outputs, **extra}, sort_keys=True) + "\n")
    return outputs
