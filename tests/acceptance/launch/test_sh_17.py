from script_runner import run_scripts

def test_every_required_action_is_usable_and_reminds_per_occurrence(): run_scripts("SH-17", ["agreement-automation-contract.mjs", "agreement-registry-contract.mjs", "production-communication-contract.mjs"], "SH17-POSITIVE")
def test_deny_duplicate_reminder_wrong_org_and_unexecutable_deep_link(): run_scripts("SH-17", ["agreement-registry-contract.mjs", "hardening-contract.mjs"], "SH17-NEGATIVE")
def test_recover_crash_between_action_and_notification(): run_scripts("SH-17", ["production-communication-contract.mjs", "temporal-delivery-contract.mjs"], "SH17-RECOVERY")
