from script_runner import run_scripts

def test_fresh_fee_lock_consumes_committed_cycle_and_schedules_next(): run_scripts("SH-25", ["recurring-contract.mjs", "provider-semantics-contract.mjs", "settlement-capability-contract.mjs"], "SH25-POSITIVE")
def test_deny_expired_authority_double_renewal_or_old_supplier_acceptance(): run_scripts("SH-25", ["recurring-contract.mjs", "agreement-contract.mjs", "vault-contract.mjs"], "SH25-NEGATIVE")
def test_recover_above_ceiling_decline_substitution_and_late_funding(): run_scripts("SH-25", ["recurring-contract.mjs", "negotiation-contract.mjs", "reliability-contract.mjs"], "SH25-RECOVERY")
