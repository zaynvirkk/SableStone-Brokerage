from script_runner import run_scripts

def test_least_privilege_tenant_retention_and_key_rotation_controls(): run_scripts("SH-28", ["hardening-contract.mjs", "vault-contract.mjs", "security-contract.mjs"], "SH28-POSITIVE")
def test_deny_ssrf_cross_org_read_replay_secrets_leak_or_unsafe_upload(): run_scripts("SH-28", ["discovery-network-contract.mjs", "hardening-contract.mjs", "extraction-contract.mjs"], "SH28-NEGATIVE")
def test_recover_key_compromise_data_request_and_processor_outage(): run_scripts("SH-28", ["reliability-contract.mjs", "authority-contract.mjs", "security-contract.mjs"], "SH28-RECOVERY")
