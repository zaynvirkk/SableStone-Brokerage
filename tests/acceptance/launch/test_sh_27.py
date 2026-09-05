from script_runner import run_scripts

def test_bounded_full_recall_prioritizes_net_ev_with_fair_waiting_lanes(): run_scripts("SH-27", ["optimizer-contract.mjs", "match-contract.mjs", "acquisition-contract.mjs"], "SH27-POSITIVE")
def test_deny_lifetime_budget_overspend_and_unfunded_buyer_ceiling_quotes(): run_scripts("SH-27", ["optimizer-contract.mjs", "cost-contract.mjs"], "SH27-NEGATIVE")
def test_recover_throttling_quote_timeout_and_unknown_billable_outcome(): run_scripts("SH-27", ["optimizer-contract.mjs", "production-connector-contract.mjs", "reliability-contract.mjs"], "SH27-RECOVERY")
