export type DiscoverySourceKind = "CPCB_COMMON_EPR" | "SPCB_PCC" | "PUBLIC_WEBSITE" | "SEARCH" | "INBOUND";
export type RegistrationClaimState = "SOURCE_STATED" | "UNVERIFIED";

export interface CrawlPolicy {
  readonly sourceAllowed: boolean;
  readonly robotsAllowed: boolean;
  readonly termsReviewed: boolean;
  readonly maxPages: number;
  readonly allowedHosts: readonly string[];
}

export interface DiscoveryPage {
  readonly canonicalUrl: string;
  readonly retrievedAt: string;
  readonly bodySha256: string;
  readonly bodyObjectKey: string;
  readonly statusCode: number;
  readonly links: readonly string[];
}

export interface OrganizationCandidate {
  readonly candidateId: string;
  readonly sourceKind: DiscoverySourceKind;
  readonly legalName: string;
  readonly website: string | null;
  readonly sourcePageUrl: string;
  readonly sourceBodySha256: string;
  readonly registrationIdentifier: string | null;
  readonly registrationState: RegistrationClaimState;
  readonly discoveredAt: string;
}

export interface HarvestResult {
  readonly pages: readonly DiscoveryPage[];
  readonly candidates: readonly OrganizationCandidate[];
  readonly stoppedReason: "COMPLETE" | "PAGE_LIMIT";
}

export function harvestFixturePages(
  sourceKind: DiscoverySourceKind,
  seedUrl: string,
  availablePages: Readonly<Record<string, DiscoveryPage>>,
  candidatesByPage: Readonly<Record<string, readonly Omit<OrganizationCandidate, "sourceKind" | "sourcePageUrl" | "sourceBodySha256">[]>>,
  policy: CrawlPolicy,
): HarvestResult {
  if (!policy.sourceAllowed || !policy.robotsAllowed || !policy.termsReviewed) {
    throw new Error("source policy does not authorize harvest");
  }
  if (!Number.isSafeInteger(policy.maxPages) || policy.maxPages < 1 || policy.maxPages > 100) {
    throw new Error("bounded page limit required");
  }
  const queue = [canonicalHttps(seedUrl, policy.allowedHosts)];
  const visited = new Set<string>();
  const pages: DiscoveryPage[] = [];
  const candidates: OrganizationCandidate[] = [];
  const dedupe = new Set<string>();
  while (queue.length && pages.length < policy.maxPages) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    const page = availablePages[url];
    if (!page) continue;
    assertDiscoveryPage(page, policy.allowedHosts);
    pages.push(Object.freeze({ ...page, links: Object.freeze([...page.links]) }));
    for (const raw of candidatesByPage[url] ?? []) {
      const registrationState: RegistrationClaimState = raw.registrationIdentifier ? raw.registrationState : "UNVERIFIED";
      const candidate = Object.freeze({ ...raw, sourceKind, sourcePageUrl: url, sourceBodySha256: page.bodySha256, registrationState });
      const key = candidate.registrationIdentifier
        ? `registration:${candidate.registrationIdentifier.trim().toUpperCase()}`
        : `name:${candidate.legalName.trim().toLocaleLowerCase("en-IN")}:${candidate.website ?? ""}`;
      if (!dedupe.has(key)) { dedupe.add(key); candidates.push(candidate); }
    }
    for (const link of page.links) {
      const canonical = canonicalHttps(link, policy.allowedHosts);
      if (!visited.has(canonical)) queue.push(canonical);
    }
  }
  return Object.freeze({
    pages: Object.freeze(pages), candidates: Object.freeze(candidates),
    stoppedReason: queue.length ? "PAGE_LIMIT" : "COMPLETE",
  });
}

function assertDiscoveryPage(page: DiscoveryPage, allowedHosts: readonly string[]): void {
  canonicalHttps(page.canonicalUrl, allowedHosts);
  if (!/^[0-9a-f]{64}$/.test(page.bodySha256) || !page.bodyObjectKey.trim()) throw new Error("source body not preserved");
  if (page.statusCode !== 200) throw new Error("only successful preserved pages can yield candidates");
  if (Number.isNaN(Date.parse(page.retrievedAt))) throw new Error("invalid retrieval time");
}

function canonicalHttps(value: string, allowedHosts: readonly string[]): string {
  const url = new URL(value);
  url.hash = "";
  if (url.protocol !== "https:" || !allowedHosts.includes(url.hostname)) throw new Error("crawl target outside reviewed HTTPS hosts");
  return url.toString();
}
