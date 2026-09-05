from script_runner import run_scripts

def test_partial_disbursement_multi_trade_batch_and_adjustments_balance(): run_scripts("SH-22", ["provider-semantics-contract.mjs", "bank-escrow-contract.mjs", "ledger-contract.mjs"], "SH22-POSITIVE")
def test_deny_double_allocation_foreign_currency_mismatch_and_invented_remainder(): run_scripts("SH-22", ["ledger-contract.mjs", "cost-contract.mjs", "bank-escrow-contract.mjs"], "SH22-NEGATIVE")
def test_recover_statement_gap_reversal_and_duplicate_bank_credit(): run_scripts("SH-22", ["reliability-contract.mjs", "provider-semantics-contract.mjs"], "SH22-RECOVERY")
