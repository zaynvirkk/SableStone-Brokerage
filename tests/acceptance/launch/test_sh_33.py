from script_runner import run_scripts

def test_connected_first_and_recurring_domestic_international_journeys(): run_scripts("SH-33", ["full-simulation.mjs", "provider-order-response-contract.mjs", "reliability-contract.mjs"], "SH33-POSITIVE")
def test_deny_each_money_identity_quantity_and_authority_invariant_mutant(): run_scripts("SH-33", ["full-simulation.mjs", "trade-contract.mjs", "vault-contract.mjs", "match-contract.mjs"], "SH33-NEGATIVE")
def test_recover_concurrent_trades_disputes_restarts_and_every_required_action(): run_scripts("SH-33", ["full-simulation.mjs", "reliability-contract.mjs", "temporal-delivery-contract.mjs"], "SH33-RECOVERY")
