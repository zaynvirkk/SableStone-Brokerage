import re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def run(*args):return subprocess.run(args,cwd=ROOT,text=True,capture_output=True,check=False)
def test_full_deterministic_zero_manual_simulation_and_rejections():
    build=run("npm","run","build");assert build.returncode==0,build.stdout+build.stderr
    first=run("node","scripts/full-simulation.mjs");assert first.returncode==0,first.stdout+first.stderr
    second=run("node","scripts/full-simulation.mjs");assert second.returncode==0,second.stdout+second.stderr
    expected="MATCHED>NEGOTIATING>PROTECTED>FEE_LOCKED>IDENTITY_RELEASED>CONTRACTED>FUNDED>DISPATCHED>IN_TRANSIT>DELIVERED>ACCEPTED>SETTLED>RECURRING"
    assert f"stages={expected}" in first.stdout
    for claim in ("contracts=20","rejection_paths=5","manual_steps=0","live_effects=0"):assert claim in first.stdout
    digest=lambda output:re.search(r"digest=([0-9a-f]{64})",output).group(1)
    assert digest(first.stdout)==digest(second.stdout)
