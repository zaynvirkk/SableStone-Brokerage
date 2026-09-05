from script_runner import run_scripts

def test_late_portal_authorization_of_one_off_demand_schedules_second_trade(): run_scripts("SH-24", ["recurring-contract.mjs", "buyer-contract.mjs", "agreement-automation-contract.mjs"], "SH24-POSITIVE")
def test_deny_unapproved_renewal_old_fee_lock_and_stale_rfq_dependency(): run_scripts("SH-24", ["recurring-contract.mjs", "lifecycle-contract.mjs", "trade-contract.mjs"], "SH24-NEGATIVE")
def test_recover_sixty_and_three_sixty_five_day_timers_after_restart(): run_scripts("SH-24", ["recurring-contract.mjs", "temporal-delivery-contract.mjs", "reliability-contract.mjs"], "SH24-RECOVERY")
