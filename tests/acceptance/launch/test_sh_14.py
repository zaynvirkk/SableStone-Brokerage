from script_runner import run_scripts

def test_rediscovery_preserves_verified_evidence_or_requalifies(): run_scripts("SH-14", ["discovery-contract.mjs", "discovery-network-contract.mjs", "production-search-contract.mjs"], "SH14-POSITIVE")
def test_deny_country_defaults_wrong_registration_scope_and_suppression_bypass(): run_scripts("SH-14", ["authority-contract.mjs", "contact-contract.mjs", "risk-contract.mjs"], "SH14-NEGATIVE")
def test_recover_expired_kyb_completed_job_and_late_inventory(): run_scripts("SH-14", ["production-credential-contract.mjs", "discovery-contract.mjs"], "SH14-RECOVERY")
