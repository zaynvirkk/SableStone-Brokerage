import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_acquisition_outreach_requires_current_exact_policy_twice():
    build = subprocess.run(
        ["npm", "run", "build"], cwd=ROOT, text=True, capture_output=True
    )
    assert build.returncode == 0, build.stdout + build.stderr
    result = subprocess.run(
        ["node", "scripts/outreach-policy-contract.mjs"],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in (
        "exact_kind=required",
        "contact=bound",
        "policy=authority_resolved",
        "jurisdiction=bounded",
        "source=bounded",
        "suppression=checked",
        "per_use=required",
        "revoked=blocked",
    ):
        assert claim in result.stdout
    creator = (ROOT / "src/runtime/acquisition_outreach.ts").read_text()
    sender = (ROOT / "src/runtime/inbox_processors.ts").read_text()
    assert creator.count("resolveCurrentAcquisitionOutreachPolicy") >= 2
    assert sender.index("assertCurrentAcquisitionOutreachPolicy(this.pool") < sender.index(
        "this.gmail.send(message, body)"
    )
    assert "'ACQUISITION',$11,$12" in creator


def test_runtime_contact_reads_match_the_migrated_ciphertext_column():
    migration = (ROOT / "migrations/0006_contacts.sql").read_text()
    assert "normalized_email_ciphertext bytea not null" in migration.lower()
    runtime = "\n".join(
        (ROOT / relative).read_text()
        for relative in (
            "src/runtime/acquisition_outreach.ts",
            "src/runtime/inbox_processors.ts",
            "src/runtime/enrichment_jobs.ts",
        )
    )
    assert "normalized_email_ciphertext" in runtime
    assert "c.email_ciphertext" not in runtime
    assert "select id,email_ciphertext" not in runtime


def test_outreach_policy_schema_is_immutable_and_jobs_are_bound():
    migration = (ROOT / "migrations/0051_outreach_policies.sql").read_text()
    for invariant in (
        "outreach_policies_no_update_delete",
        "OUTREACH_POLICY_APPROVAL",
        "allowed_jurisdictions",
        "allowed_contact_sources",
        "allowed_organization_roles",
        "outbound_email_jobs_acquisition_policy_check",
        "source_contact_id",
        "outreach_policy_version",
    ):
        if invariant == "OUTREACH_POLICY_APPROVAL":
            continue
        assert invariant in migration
    policy = (ROOT / "src/runtime/outreach_policy.ts").read_text()
    assert "OUTREACH_POLICY_APPROVAL" in policy
