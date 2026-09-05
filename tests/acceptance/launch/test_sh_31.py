from script_runner import run_scripts

def test_clean_configured_api_web_workers_connect_to_private_services(): run_scripts("SH-31", ["production-boundary-contract.mjs", "production-credential-contract.mjs", "discovery-network-contract.mjs"], "SH31-POSITIVE")
def test_deny_missing_tool_secret_migration_or_unsupported_storage_capability(): run_scripts("SH-31", ["production-boundary-contract.mjs", "production-credential-contract.mjs", "hardening-contract.mjs"], "SH31-NEGATIVE")
def test_recover_rolling_deploy_health_failure_and_schema_compatible_rollback(): run_scripts("SH-31", ["reliability-contract.mjs", "production-boundary-contract.mjs"], "SH31-RECOVERY")
