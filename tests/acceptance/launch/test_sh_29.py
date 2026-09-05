from script_runner import run_scripts

def test_health_fault_freezes_affected_risk_but_preserves_money_resolution(): run_scripts("SH-29", ["hardening-contract.mjs", "settlement-capability-contract.mjs", "reliability-contract.mjs"], "SH29-POSITIVE")
def test_deny_all_new_business_when_authority_expired_and_never_fake_reapproval(): run_scripts("SH-29", ["authority-contract.mjs", "production-boundary-contract.mjs"], "SH29-NEGATIVE")
def test_recover_provider_shutdown_backlog_budget_exhaustion_and_new_credential(): run_scripts("SH-29", ["production-credential-contract.mjs", "reliability-contract.mjs", "production-connector-contract.mjs"], "SH29-RECOVERY")
