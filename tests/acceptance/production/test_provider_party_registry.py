import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]

def test_provider_party_registry_is_schema_checked_and_fail_closed():
    build=subprocess.run(["npm","run","build"],cwd=ROOT,text=True,capture_output=True)
    assert build.returncode==0,build.stdout+build.stderr
    result=subprocess.run(["node","scripts/provider-party-registry-contract.mjs"],cwd=ROOT,text=True,capture_output=True)
    assert result.returncode==0,result.stdout+result.stderr
    assert "valid=15 rejected=6 canonical=true" in result.stdout

def test_provider_party_registry_is_immutable_receipt_backed_and_system_gated():
    migration=(ROOT/"migrations/0046_provider_party_account_registry.sql").read_text()
    runtime=(ROOT/"src/runtime/provider_parties.ts").read_text()
    api=(ROOT/"src/api/server.ts").read_text()
    startup=(ROOT/"scripts/start-production-api.mjs").read_text()
    for requirement in (
        "provider_party_accounts_verification_receipt_fk",
        "provider_party_accounts_external_identity_unique",
        "provider_party_accounts_no_update_delete",
        "provider_party_account_revocations_no_update_delete",
    ):
        assert requirement in migration
    for requirement in (
        "authority_kind='PROVIDER_ACCOUNT_VERIFICATION'",
        "current production provider approval missing",
        "provider external identity already belongs to another organization",
        "this.cipher.encrypt(canonical)",
        "authority_kind='PROVIDER_ACCOUNT_REVOCATION'",
        "verification_expires_at",
        "provider party mapping schema mismatch",
    ):
        assert requirement in runtime
    assert 'allowedRoles: ["SYSTEM"]' in api
    assert 'capabilities.includes("SETTLEMENT")' in api
    assert '["OUTREACH", "TRADING", "SETTLEMENT"]' in startup
    assert "return Object.freeze({ id, referenceSha256 })" in runtime
