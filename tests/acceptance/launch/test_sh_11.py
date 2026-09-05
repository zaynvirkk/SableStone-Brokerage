from script_runner import run_scripts

def test_verified_contact_completes_hosted_provider_kyb_to_bound_account(): run_scripts("SH-11", ["provider-party-registry-contract.mjs", "production-credential-contract.mjs"], "SH11-POSITIVE")
def test_deny_unverified_replaced_or_cross_org_beneficiary(): run_scripts("SH-11", ["provider-party-registry-contract.mjs", "risk-contract.mjs"], "SH11-NEGATIVE")
def test_recover_invitation_duplicate_create_and_provider_rejection(): run_scripts("SH-11", ["provider-party-registry-contract.mjs", "production-connector-contract.mjs"], "SH11-RECOVERY")
