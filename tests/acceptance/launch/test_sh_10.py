from script_runner import run_scripts

def test_verified_assignment_preserves_precise_legal_and_cash_state(): run_scripts("SH-10", ["lc-contract.mjs", "settlement-capability-contract.mjs"], "SH10-POSITIVE")
def test_deny_assignment_as_cash_secured_or_automatic_guarantee(): run_scripts("SH-10", ["lc-contract.mjs", "trade-contract.mjs"], "SH10-NEGATIVE")
def test_recover_discrepancy_expiry_and_assignment_revocation(): run_scripts("SH-10", ["lc-contract.mjs", "authority-contract.mjs"], "SH10-RECOVERY")
