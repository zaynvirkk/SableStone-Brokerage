from script_runner import run_scripts

def test_accepted_snapshot_matches_every_allocation(): run_scripts("SH-03", ["cost-contract.mjs", "production-economics-contract.mjs", "waterfall-contract.mjs"], "SH03-POSITIVE")
def test_reject_stale_costs_unknown_taxes_or_hidden_principal_exposure(): run_scripts("SH-03", ["cost-contract.mjs", "waterfall-contract.mjs", "trade-contract.mjs"], "SH03-NEGATIVE")
def test_retry_negotiation_acceptance_with_one_snapshot(): run_scripts("SH-03", ["production-economics-contract.mjs", "negotiation-contract.mjs"], "SH03-RECOVERY")
