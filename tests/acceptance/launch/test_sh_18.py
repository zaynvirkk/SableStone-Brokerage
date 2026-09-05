from script_runner import run_scripts

def test_invite_authenticate_sign_and_deprovision_exact_org_role(): run_scripts("SH-18", ["production-credential-contract.mjs", "security-contract.mjs", "agreement-contract.mjs"], "SH18-POSITIVE")
def test_deny_revoked_principal_idp_subject_mismatch_and_bank_change_fraud(): run_scripts("SH-18", ["security-contract.mjs", "provider-party-registry-contract.mjs", "hardening-contract.mjs"], "SH18-NEGATIVE")
def test_recover_invite_timeout_reauth_and_key_rotation(): run_scripts("SH-18", ["production-credential-contract.mjs", "security-contract.mjs"], "SH18-RECOVERY")
