from script_runner import run_scripts

def test_uploaded_source_yields_cited_rich_specs_and_safe_anonymous_copy(): run_scripts("SH-16", ["extraction-contract.mjs", "commercial-extraction-contract.mjs", "production-spec-contract.mjs"], "SH16-POSITIVE")
def test_deny_malware_prompt_injection_ocr_leak_and_false_verification(): run_scripts("SH-16", ["extraction-contract.mjs", "production-document-verifier-contract.mjs", "vault-contract.mjs"], "SH16-NEGATIVE")
def test_recover_ocr_outage_conflicting_certificate_and_legal_hold(): run_scripts("SH-16", ["production-document-verifier-contract.mjs", "extraction-contract.mjs"], "SH16-RECOVERY")
