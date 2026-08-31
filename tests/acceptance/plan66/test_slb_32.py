import json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def run(*args):return subprocess.run(args,cwd=ROOT,text=True,capture_output=True,check=False)
def test_release_candidate_sbom_signature_and_disabled_live_flags():
    root=run("npm","audit","--offline","--audit-level=high");assert root.returncode==0,root.stdout+root.stderr
    web=run("npm","--prefix","apps/web","audit","--offline","--audit-level=high");assert web.returncode==0,web.stdout+web.stderr
    check=run("node","scripts/verify-release.mjs");assert check.returncode==0,check.stdout+check.stderr
    for claim in ("signed=true","sbom=true","live_flags=false","operator_gates=blocked"):assert claim in check.stdout
    sbom=json.loads((ROOT/"releases/plan66-sbom.cdx.json").read_text());assert sbom["bomFormat"]=="CycloneDX" and sbom["components"]
def test_production_checklist_keeps_external_gates_open():
    checklist=(ROOT/"docs/production-checklist.md").read_text()
    for task in range(33,40):assert f"SLB-{task}" in checklist
    assert "- [ ] SLB-33" in checklist and "- [ ] SLB-39" in checklist
    config=(ROOT/"src/config.ts").read_text()
    for flag in ("liveTrading: false","liveOutreach: false","liveSettlement: false","productionProviders: false"):assert flag in config
