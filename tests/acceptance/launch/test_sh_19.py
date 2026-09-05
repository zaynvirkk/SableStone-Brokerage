from script_runner import run_scripts

def test_current_signers_accept_exact_match_trade_and_service_terms(): run_scripts("SH-19", ["agreement-automation-contract.mjs", "agreement-registry-contract.mjs", "agreement-contract.mjs"], "SH19-POSITIVE")
def test_deny_stale_commission_reused_acceptance_and_unsigned_variation(): run_scripts("SH-19", ["agreement-registry-contract.mjs", "agreement-contract.mjs", "vault-contract.mjs"], "SH19-NEGATIVE")
def test_recover_late_signature_template_expiry_and_preexisting_relationship_claim(): run_scripts("SH-19", ["agreement-automation-contract.mjs", "authority-contract.mjs"], "SH19-RECOVERY")
