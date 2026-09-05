from script_runner import run_scripts

def test_provider_resolution_authorizes_payout_or_actual_refund_and_closing(): run_scripts("SH-21", ["provider-semantics-contract.mjs", "trade-contract.mjs", "lifecycle-contract.mjs"], "SH21-POSITIVE")
def test_deny_local_cancel_as_refund_or_buyer_acceptance_required_after_award(): run_scripts("SH-21", ["trade-contract.mjs", "lifecycle-contract.mjs", "settlement-capability-contract.mjs"], "SH21-NEGATIVE")
def test_recover_stalled_dispute_late_reversal_and_post_settlement_adjustments(): run_scripts("SH-21", ["provider-semantics-contract.mjs", "reliability-contract.mjs"], "SH21-RECOVERY")
