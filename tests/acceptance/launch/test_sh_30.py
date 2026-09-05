from script_runner import run_scripts

def test_net_cash_contribution_and_repeat_outcomes_drive_supported_ev(): run_scripts("SH-30", ["optimizer-contract.mjs", "ledger-contract.mjs", "production-economics-contract.mjs"], "SH30-POSITIVE")
def test_deny_projected_ltv_as_revenue_tax_as_profit_or_duplicate_probability(): run_scripts("SH-30", ["optimizer-contract.mjs", "ledger-contract.mjs", "cost-contract.mjs"], "SH30-NEGATIVE")
def test_recover_loss_lane_zero_response_and_prediction_drift(): run_scripts("SH-30", ["optimizer-contract.mjs", "reliability-contract.mjs"], "SH30-RECOVERY")
