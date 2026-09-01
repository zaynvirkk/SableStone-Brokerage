import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type {
  CrawlPolicy,
  DiscoveryPage,
  DiscoverySourceKind,
  OrganizationCandidate,
} from "../discovery.js";
import type { EvidenceReceipt } from "../runtime/object_store.js";
import {
  createPinnedPublicFetch,
  readBoundedResponseBody,
} from "../runtime/public_network.js";

export interface ReceiptWriter {
  preserve(
    prefix: string,
    body: Uint8Array,
    contentType: string,
    source: string,
    storedAt?: string,
  ): Promise<EvidenceReceipt>;
}
export interface SourceParser {
  parse(input: {
    url: string;
    contentType: string;
    body: Uint8Array;
    receipt: EvidenceReceipt;
    retrievedAt: string;
  }): Promise<{
    links: readonly string[];
    candidates: readonly Omit<
      OrganizationCandidate,
      "sourceKind" | "sourcePageUrl" | "sourceBodySha256"
    >[];
  }>;
}
export interface LiveHarvestResult {
  readonly pages: readonly DiscoveryPage[];
  readonly candidates: readonly OrganizationCandidate[];
  readonly stoppedReason: "COMPLETE" | "PAGE_LIMIT";
}
export class ReviewedHttpDiscoveryConnector {
  constructor(
    readonly sourceKind: DiscoverySourceKind,
    readonly policy: CrawlPolicy,
    readonly store: ReceiptWriter,
    readonly parser: SourceParser,
    readonly fetcher: typeof fetch = createPinnedPublicFetch(),
  ) {}
  async harvest(
    seedUrl: string,
    now: () => string = () => new Date().toISOString(),
  ): Promise<LiveHarvestResult> {
    if (
      !this.policy.sourceAllowed ||
      !this.policy.robotsAllowed ||
      !this.policy.termsReviewed
    )
      throw new Error("source policy does not authorize live harvest");
    if (this.policy.maxPages < 1 || this.policy.maxPages > 100)
      throw new Error("bounded page limit required");
    const queue = [this.canonical(seedUrl)],
      visited = new Set<string>(),
      pages: DiscoveryPage[] = [],
      candidates: OrganizationCandidate[] = [],
      dedupe = new Set<string>();
    while (queue.length && pages.length < this.policy.maxPages) {
      const url = queue.shift();
      if (!url || visited.has(url)) continue;
      visited.add(url);
      const response = await this.fetcher(url, {
        redirect: "manual",
        headers: {
          accept: "text/html,application/json,application/pdf;q=0.8",
          "user-agent": "SableStoneComplianceFetcher/1.0",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("redirect without location");
        queue.unshift(this.canonical(new URL(location, url).toString()));
        continue;
      }
      if (response.status !== 200)
        throw new Error(`source HTTP ${response.status}`);
      const body = await readBoundedResponseBody(response, 10_000_000);
      const retrievedAt = now(),
        contentType =
          response.headers.get("content-type")?.split(";")[0] ??
          "application/octet-stream",
        receipt = await this.store.preserve(
          "discovery",
          body,
          contentType,
          url,
          retrievedAt,
        );
      if (receipt.sha256 !== createHash("sha256").update(body).digest("hex"))
        throw new Error("source receipt mismatch");
      const parsed = await this.parser.parse({
          url,
          contentType,
          body,
          receipt,
          retrievedAt,
        }),
        links = parsed.links.map((link) =>
          this.canonical(new URL(link, url).toString()),
        );
      pages.push(
        Object.freeze({
          canonicalUrl: url,
          retrievedAt,
          bodySha256: receipt.sha256,
          bodyObjectKey: receipt.objectKey,
          statusCode: response.status,
          links: Object.freeze(links),
        }),
      );
      for (const raw of parsed.candidates) {
        const candidate = Object.freeze({
            ...raw,
            sourceKind: this.sourceKind,
            sourcePageUrl: url,
            sourceBodySha256: receipt.sha256,
            registrationState: raw.registrationIdentifier
              ? raw.registrationState
              : ("UNVERIFIED" as const),
          }),
          key = candidate.registrationIdentifier
            ? `r:${candidate.registrationIdentifier.trim().toUpperCase()}`
            : `n:${candidate.legalName.trim().toLowerCase()}:${candidate.website ?? ""}`;
        if (!dedupe.has(key)) {
          dedupe.add(key);
          candidates.push(candidate);
        }
      }
      for (const link of links) if (!visited.has(link)) queue.push(link);
    }
    return Object.freeze({
      pages: Object.freeze(pages),
      candidates: Object.freeze(candidates),
      stoppedReason: queue.length ? "PAGE_LIMIT" : "COMPLETE",
    });
  }
  private canonical(value: string): string {
    const url = new URL(value),
      hostname = url.hostname.replace(/^\[|\]$/g, "");
    url.hash = "";
    if (
      url.protocol !== "https:" ||
      isIP(hostname) !== 0 ||
      !this.policy.allowedHosts.includes(hostname)
    )
      throw new Error("crawl target outside reviewed HTTPS domain hosts");
    return url.toString();
  }
}

export class StructuredRegistryParser implements SourceParser {
  constructor(
    readonly extract: (
      body: string,
      url: string,
    ) => readonly {
      legalName: string;
      website?: string;
      registrationIdentifier?: string;
    }[],
  ) {}
  async parse(input: {
    url: string;
    contentType: string;
    body: Uint8Array;
    receipt: EvidenceReceipt;
    retrievedAt: string;
  }) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(input.body),
      rows = this.extract(text, input.url);
    return {
      links: Object.freeze([]),
      candidates: Object.freeze(
        rows.map((row, index) =>
          Object.freeze({
            candidateId: `${input.receipt.sha256.slice(0, 20)}-${index}`,
            legalName: row.legalName,
            website: row.website ?? null,
            registrationIdentifier: row.registrationIdentifier ?? null,
            registrationState: row.registrationIdentifier
              ? ("SOURCE_STATED" as const)
              : ("UNVERIFIED" as const),
            discoveredAt: input.retrievedAt,
          }),
        ),
      ),
    };
  }
}
