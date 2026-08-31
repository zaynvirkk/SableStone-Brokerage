import { harvestFixturePages } from "../dist/index.js";
const host = "registry.fixture.invalid";
const first = `https://${host}/stakeholders`;
const second = `https://${host}/stakeholders?page=2`;
const digestA = "a".repeat(64), digestB = "b".repeat(64);
const pages = {
  [first]: { canonicalUrl: first, retrievedAt: "2026-08-31T00:00:00Z", bodySha256: digestA, bodyObjectKey: "receipts/a", statusCode: 200, links: [second] },
  [second]: { canonicalUrl: second, retrievedAt: "2026-08-31T00:00:01Z", bodySha256: digestB, bodyObjectKey: "receipts/b", statusCode: 200, links: [] },
};
const raw = (id, name, registrationIdentifier, registrationState) => ({ candidateId: id, legalName: name, website: null, registrationIdentifier, registrationState, discoveredAt: "2026-08-31T00:00:00Z" });
const candidates = {
  [first]: [raw("1", "Fixture Recycler", "PWP-1", "SOURCE_STATED"), raw("2", "No Registry Claim", null, "SOURCE_STATED")],
  [second]: [raw("3", "Fixture Recycler Duplicate", "pwp-1", "SOURCE_STATED")],
};
const policy = { sourceAllowed: true, robotsAllowed: true, termsReviewed: true, maxPages: 2, allowedHosts: [host] };
const result = harvestFixturePages("CPCB_COMMON_EPR", first, pages, candidates, policy);
if (result.pages.length !== 2 || result.candidates.length !== 2) throw new Error("harvest/dedupe failed");
if (result.candidates[1].registrationState !== "UNVERIFIED") throw new Error("registration inferred from discovery");
let rejected = 0;
for (const bad of [
  { ...policy, robotsAllowed: false }, { ...policy, termsReviewed: false }, { ...policy, maxPages: 0 },
]) { try { harvestFixturePages("CPCB_COMMON_EPR", first, pages, candidates, bad); } catch { rejected += 1; } }
try { harvestFixturePages("SEARCH", "https://outside.invalid/", pages, candidates, policy); } catch { rejected += 1; }
if (rejected !== 4) throw new Error("crawl policy failed open");
console.log("DISCOVERY_OK pages=2 candidates=2 negatives=4 registration_not_inferred=true");
