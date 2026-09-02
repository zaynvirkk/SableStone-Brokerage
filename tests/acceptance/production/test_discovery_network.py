import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_reviewed_discovery_pins_only_public_dns_answers():
    build = subprocess.run(
        ["npm", "run", "build"], cwd=ROOT, text=True, capture_output=True
    )
    assert build.returncode == 0, build.stdout + build.stderr
    result = subprocess.run(
        ["node", "scripts/discovery-network-contract.mjs"],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    for claim in (
        "public=accepted",
        "private_blocked=18",
        "mixed_rebinding=blocked",
        "family_mismatch=blocked",
        "empty_dns=blocked",
        "literal_ip=blocked",
        "http=blocked",
        "redirects=error_default",
        "origin_escape=blocked",
        "url_credentials=blocked",
        "pinned=true",
        "response_stream=bounded",
    ):
        assert claim in result.stdout


def test_production_discovery_default_uses_connection_time_pin():
    connector = (ROOT / "src/connectors/discovery_http.ts").read_text()
    boundary = (ROOT / "src/runtime/public_network.ts").read_text()
    assert "fetcher: typeof fetch = createPinnedPublicFetch()" in connector
    assert "isIP(hostname) !== 0" in connector
    assert "connect: { lookup: createPinnedPublicLookup(resolver) }" in boundary
    assert "dnsLookup(hostname, { all: true, verbatim: true })" in boundary
    assert "for (const result of addresses)" in boundary
    assert 'redirect: init?.redirect ?? "error"' in boundary
    assert "endpoint.origin !== base.origin" in boundary


def test_all_production_http_connector_responses_are_stream_bounded():
    connectors = (
        "acquisition_graph.ts",
        "commercial_extraction.ts",
        "discovery_http.ts",
        "documents.ts",
        "economic_quotes.ts",
        "enrichment.ts",
        "kyb.ts",
        "settlement_http.ts",
    )
    for name in connectors:
        source = (ROOT / "src/connectors" / name).read_text()
        assert "response.arrayBuffer()" not in source, name
        assert "readBoundedResponseBody" in source, name
        assert "createPinnedPublicFetch()" in source, name
        assert "typeof fetch = fetch" not in source, name


def test_production_factories_cannot_override_pinned_fetch_with_global_fetch():
    factories = (
        "src/connectors/commercial_extraction.ts",
        "src/runtime/document_jobs.ts",
        "src/runtime/economic_jobs.ts",
        "src/runtime/enrichment_jobs.ts",
        "src/runtime/kyb_jobs.ts",
        "src/runtime/provider_factory.ts",
        "src/runtime/search.ts",
    )
    for relative in factories:
        source = (ROOT / relative).read_text()
        assert "createPinnedPublicFetch()" in source, relative
        assert "\n    fetch," not in source, relative
        assert "\n      fetch," not in source, relative
        assert "\n        fetch," not in source, relative


def test_configurable_provider_paths_cannot_override_approved_origins():
    connectors = (
        "commercial_extraction.ts",
        "documents.ts",
        "economic_quotes.ts",
        "kyb.ts",
        "settlement_http.ts",
    )
    for name in connectors:
        source = (ROOT / "src/connectors" / name).read_text()
        assert (
            "resolveExternalProviderEndpoint" in source
            or "assertPublicHttpsDomainUrl" in source
        ), name
    kyb = (ROOT / "src/connectors/kyb.ts").read_text()
    assert 'url.hostname === "trade.gov"' in kyb
    assert 'url.hostname.endsWith(".trade.gov")' in kyb
