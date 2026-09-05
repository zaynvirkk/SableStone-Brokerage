from script_runner import run_scripts

def test_approved_order_vendor_hold_release_and_refund_contract(): run_scripts("SH-06", ["cashfree-contract.mjs", "provider-order-response-contract.mjs"], "SH06-POSITIVE")
def test_deny_finite_delay_without_delivery_conditional_protection(): run_scripts("SH-06", ["cashfree-contract.mjs", "settlement-capability-contract.mjs"], "SH06-NEGATIVE")
def test_recover_capture_split_hold_release_timeout(): run_scripts("SH-06", ["cashfree-contract.mjs", "provider-semantics-contract.mjs"], "SH06-RECOVERY")
