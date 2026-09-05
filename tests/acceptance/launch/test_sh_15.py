from script_runner import run_scripts

def test_first_outreach_reply_refresh_and_exact_negotiation_thread(): run_scripts("SH-15", ["email-contract.mjs", "production-communication-contract.mjs", "negotiation-contract.mjs"], "SH15-POSITIVE")
def test_deny_wrong_thread_unsubscribe_and_unsupported_commercial_promises(): run_scripts("SH-15", ["email-contract.mjs", "outreach-policy-contract.mjs", "negotiation-contract.mjs"], "SH15-NEGATIVE")
def test_recover_watch_expiry_history_gap_send_timeout_and_bounce(): run_scripts("SH-15", ["production-communication-contract.mjs", "email-contract.mjs"], "SH15-RECOVERY")
