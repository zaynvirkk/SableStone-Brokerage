from script_runner import run_scripts

def test_restore_isolated_copy_and_replay_to_exact_money_state(): run_scripts("SH-32", ["reliability-contract.mjs", "temporal-delivery-contract.mjs"], "SH32-POSITIVE")
def test_deny_backup_only_success_without_restore_and_duplicate_disbursement(): run_scripts("SH-32", ["reliability-contract.mjs", "ledger-contract.mjs"], "SH32-NEGATIVE")
def test_recover_database_loss_provider_gap_and_temporal_history_replay(): run_scripts("SH-32", ["reliability-contract.mjs", "production-event-processing-contract.mjs", "temporal-delivery-contract.mjs"], "SH32-RECOVERY")
