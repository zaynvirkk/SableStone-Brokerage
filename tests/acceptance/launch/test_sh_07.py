from script_runner import run_scripts

def test_native_checkout_capture_held_transfer_release_reconcile(): run_scripts("SH-07", ["razorpay-contract.mjs", "provider-order-response-contract.mjs"], "SH07-POSITIVE")
def test_deny_early_release_wrong_paise_or_unapproved_linked_account(): run_scripts("SH-07", ["razorpay-contract.mjs", "provider-party-registry-contract.mjs"], "SH07-NEGATIVE")
def test_recover_lost_transfer_response_and_late_reversal(): run_scripts("SH-07", ["razorpay-contract.mjs", "provider-semantics-contract.mjs"], "SH07-RECOVERY")
