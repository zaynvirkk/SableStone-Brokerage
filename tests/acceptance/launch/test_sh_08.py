from script_runner import run_scripts

def test_broker_items_private_funding_shipping_acceptance_disburse(): run_scripts("SH-08", ["escrow-contract.mjs", "provider-order-response-contract.mjs"], "SH08-POSITIVE")
def test_deny_created_not_secured_and_provider_identity_leak(): run_scripts("SH-08", ["escrow-contract.mjs", "vault-contract.mjs"], "SH08-NEGATIVE")
def test_recover_poll_shipping_rejection_and_return_process(): run_scripts("SH-08", ["escrow-contract.mjs", "provider-semantics-contract.mjs"], "SH08-RECOVERY")
