import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]

def test_agreement_acceptance_is_bound_to_exact_resource_and_organization():
    build=subprocess.run(["npm","run","build"],cwd=ROOT,text=True,capture_output=True)
    assert build.returncode==0,build.stdout+build.stderr
    migration=(ROOT/"migrations/0047_agreement_resource_bindings.sql").read_text()
    commands=(ROOT/"src/runtime/commands.ts").read_text()
    api=(ROOT/"src/api/server.ts").read_text()
    for requirement in (
        "create table agreement_resource_bindings",
        "resource_type in ('ORG_MASTER','MATCH','TRADE')",
        "agreement_binding_id uuid references agreement_resource_bindings(id)",
        "legacy agreement acceptances require receipt-backed resource binding migration",
        "agreement_resource_bindings_no_update_delete",
    ):
        assert requirement in migration
    for requirement in (
        "bindingId: agreement.agreement_binding_id",
        "bindingSha256: agreement.binding_sha256",
        "b.resource_type='MATCH' and b.resource_id=$3 and b.role=$4",
        "b.resource_type='ORG_MASTER' and b.resource_id=$1",
        "b.resource_type='TRADE' and b.resource_id=$3 and b.role=$4",
    ):
        assert requirement in commands
    assert "agreementBindingId: string" in commands
    assert "agreementBindingId?: string" in api
    assert "b.expected_organization_id=$4 and b.role=$5" in api
    assert "agreement_binding_id" in api

def test_kind_only_acceptance_queries_are_not_present():
    commands=(ROOT/"src/runtime/commands.ts").read_text()
    forbidden=(
        "where aa.id=$1 and aa.signer_organization_id=$2 and aa.expected_organization_id=$2 and aa.accepted_at<aa.otp_expires_at and a.effective_at<=$3",
        "where aa.signer_organization_id=$1 and a.agreement_kind=$2",
        "where aa.id=$1 and aa.signer_organization_id=$2 and aa.expected_organization_id=$2 and aa.accepted_at<aa.otp_expires_at and a.agreement_kind='TRANSACTION_CONFIRMATION'",
    )
    for unsafe in forbidden:
        assert unsafe not in commands

def test_bound_agreement_body_is_digest_verified_and_organization_scoped():
    api=(ROOT/"src/api/server.ts").read_text()
    proxy=(ROOT/"apps/web/app/api/agreements/[id]/[version]/bindings/[bindingId]/body/route.ts").read_text()
    buyer=(ROOT/"apps/web/app/buyer/page.tsx").read_text()
    supplier=(ROOT/"apps/web/app/supplier/page.tsx").read_text()
    assert "deps.evidenceStore.readVerified" in api
    assert "b.expected_organization_id=$4 and b.role=$5" in api
    assert 'header("cache-control", "private, no-store")' in api
    assert 'header("x-content-type-options", "nosniff")' in api
    assert 'header("x-sablestone-body-sha256"' in api
    assert 'get("sablestone_session")' in proxy
    assert "AGREEMENT_DIGEST_MISSING" in proxy
    assert 'vary: "Cookie"' in proxy
    assert "AgreementRegister" in buyer
    assert "AgreementRegister" in supplier
