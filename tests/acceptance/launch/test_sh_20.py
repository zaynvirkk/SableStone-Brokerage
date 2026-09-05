from script_runner import run_scripts

def test_onboard_carrier_ingest_tracking_and_accept_evidenced_delivery(): run_scripts("SH-20", ["supplier-contract.mjs", "production-spec-contract.mjs", "extraction-contract.mjs"], "SH20-POSITIVE")
def test_deny_forged_pod_wrong_batch_unauthorized_carrier_or_early_release(): run_scripts("SH-20", ["trade-contract.mjs", "authority-contract.mjs", "hardening-contract.mjs"], "SH20-NEGATIVE")
def test_recover_carrier_outage_partial_delivery_and_silence(): run_scripts("SH-20", ["production-connector-contract.mjs", "reliability-contract.mjs"], "SH20-RECOVERY")
