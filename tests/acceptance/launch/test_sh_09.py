from script_runner import run_scripts

def test_versioned_bank_protocol_funding_hold_split_and_feed(): run_scripts("SH-09", ["bank-escrow-contract.mjs", "production-connector-contract.mjs"], "SH09-POSITIVE")
def test_deny_generic_acknowledgement_or_manual_bank_only_boundary(): run_scripts("SH-09", ["bank-escrow-contract.mjs", "settlement-capability-contract.mjs"], "SH09-NEGATIVE")
def test_recover_partial_batch_feed_gap_and_payment_unknown(): run_scripts("SH-09", ["bank-escrow-contract.mjs", "production-event-processing-contract.mjs"], "SH09-RECOVERY")
