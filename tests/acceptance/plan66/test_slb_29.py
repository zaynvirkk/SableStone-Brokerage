import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "apps" / "web"

def run(*args):
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)

def test_complete_product_surfaces_build_and_preserve_boundaries():
    result = run("npm", "--prefix", "apps/web", "run", "build")
    assert result.returncode == 0, result.stdout + result.stderr
    output = result.stdout + result.stderr
    for route in ("/buyer", "/operations", "/supplier", "/trade/[id]"):
        assert route in output
    source = "\n".join(path.read_text() for path in (WEB / "app").rglob("*.tsx"))
    for phrase in ("Synthetic fixture", "Identity", "Sealed", "disabled", "Supplier remains seller"):
        assert phrase.lower() in source.lower()
    assert 'data-direction-contract="80369743"' in source

def test_responsive_accessible_fail_closed_state_language_is_present():
    css = (WEB / "app" / "styles.css").read_text()
    assert "@media (max-width: 820px)" in css
    assert "@media (max-width: 480px)" in css
    assert "min-width: 320px" in css
    assert ":focus-visible" in css
    operations = (WEB / "app" / "operations" / "page.tsx").read_text()
    for state in ("Loading", "Empty", "Stale", "Unavailable", "Rejected", "Expired", "Frozen", "Reversed", "Degraded", "Success"):
        assert state in operations
    assert (ROOT / "artifacts/ui/operations-desktop.png").is_file()
    assert (ROOT / "artifacts/ui/operations-mobile.png").is_file()
    assert (ROOT / "DESIGN.md").is_file()
    assert (ROOT / ".impeccable/design.json").is_file()
