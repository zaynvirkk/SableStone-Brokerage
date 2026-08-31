import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
PORTFOLIO = ROOT.parents[1]


def test_product_is_distinct_and_complete_contract() -> None:
    product = (ROOT / "PRODUCT.md").read_text()
    readme = (ROOT / "README.md").read_text()
    agents = (ROOT / "AGENTS.md").read_text()

    assert "commission broker" in product
    assert "supplier remains seller of record" in product.lower()
    assert "sablestone-duty" in readme
    assert "customs-duty recovery product" in readme
    assert "Identity release is a server-side choke point" in agents

    for invariant in (
        "SABLESTONE_INVENTORY = 0",
        "SABLESTONE_CARGO_CAPITAL = 0",
        "SABLESTONE_CREDIT_EXPOSURE = 0",
    ):
        assert invariant in product

    for prohibited_role in (
        "takes title",
        "holds buyer purchase money",
        "finances cargo",
        "grants credit",
        "acts as customs broker",
    ):
        assert prohibited_role in product


def test_all_live_capabilities_default_off() -> None:
    config = json.loads((ROOT / "config" / "defaults.json").read_text())
    assert config["schema_version"] == "sablestone-runtime-config-v1"
    for key in (
        "live_trading",
        "live_outreach",
        "live_settlement",
        "production_providers",
    ):
        assert config[key] is False
    assert config["missing_evidence"] == "UNKNOWN"
    assert config["sablestone_inventory"] == "0"
    assert config["sablestone_cargo_capital"] == "0"
    assert config["sablestone_credit_exposure"] == "0"


def test_plan_and_manifest_register_exact_bootstrap() -> None:
    plan = (PORTFOLIO / "plans" / "66_LANE_sablestone_autonomous_polymer_brokerage.md").read_text()
    manifest = json.loads((PORTFOLIO / "plans" / "completion" / "66.json").read_text())
    registry = json.loads((PORTFOLIO / "plans" / "completion" / "plans.json").read_text())

    assert "SLB-00" in plan and "SLB-32" in plan
    assert manifest["plan_id"] == "66"
    assert manifest["tasks"][0]["task_id"] == "SLB-00"
    assert any(item["plan_id"] == "66" for item in registry["plans"])


def test_fixture_boundary_is_explicit() -> None:
    fixture_readme = (ROOT / "tests" / "acceptance" / "plan66" / "fixtures" / "README.md").read_text()
    assert "synthetic" in fixture_readme
    assert "never legal approval" in fixture_readme
    assert "never" in fixture_readme and "revenue" in fixture_readme
