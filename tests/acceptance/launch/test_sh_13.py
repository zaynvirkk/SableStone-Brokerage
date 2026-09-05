from script_runner import run_scripts

def test_scheduled_refresh_updates_exact_lot_and_wakes_waiting_match(): run_scripts("SH-13", ["supplier-contract.mjs", "buyer-contract.mjs", "qualification-fixture.mjs"], "SH13-POSITIVE")
def test_deny_stale_stock_duplicate_lot_and_fabricated_current_demand(): run_scripts("SH-13", ["qualification-fixture.mjs", "cost-contract.mjs"], "SH13-NEGATIVE")
def test_recover_no_reply_sold_out_and_source_version_conflict(): run_scripts("SH-13", ["supplier-contract.mjs", "authority-contract.mjs"], "SH13-RECOVERY")
