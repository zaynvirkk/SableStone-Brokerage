from script_runner import run_scripts

def test_current_secured_entitlement_allows_exact_disclosure(): run_scripts("SH-05", ["vault-contract.mjs", "settlement-capability-contract.mjs"], "SH05-POSITIVE")
def test_deny_created_order_unfunded_lc_stale_terms_and_document_leaks(): run_scripts("SH-05", ["vault-contract.mjs", "trade-contract.mjs", "lc-contract.mjs"], "SH05-NEGATIVE")
def test_revalidate_revocation_and_competing_release_atomically(): run_scripts("SH-05", ["lifecycle-contract.mjs", "provider-semantics-contract.mjs"], "SH05-RECOVERY")
