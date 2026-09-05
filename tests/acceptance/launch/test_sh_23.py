from script_runner import run_scripts

def test_snapshot_invoice_credit_note_tax_and_bank_sums_agree(): run_scripts("SH-23", ["ledger-contract.mjs", "production-economics-contract.mjs", "cost-contract.mjs"], "SH23-POSITIVE")
def test_deny_material_invoice_revenue_double_count_tax_in_cash_profit(): run_scripts("SH-23", ["ledger-contract.mjs", "trade-contract.mjs"], "SH23-NEGATIVE")
def test_recover_withholding_partial_payments_and_period_correction(): run_scripts("SH-23", ["ledger-contract.mjs", "cost-contract.mjs", "reliability-contract.mjs"], "SH23-RECOVERY")
