import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  ReviewedHttpDiscoveryConnector,
  type SourceParser,
} from "../connectors/discovery_http.js";
import type {
  DiscoverySourceKind,
  OrganizationCandidate,
} from "../discovery.js";
import {
  buildBuyerNode,
  type AcquisitionEvidence,
  type BraveSearchConnector,
  type BuyerApplication,
  type PolymerSignal,
} from "../connectors/acquisition_graph.js";
import { PRODUCT_FAMILIES, type ProductFamily } from "../domain.js";
import type { ImmutableEvidenceStore } from "./object_store.js";
import { inTransaction } from "./database.js";
import type { SensitiveDataCipher } from "./sensitive_data.js";

type JsonParserConfig = {
  type: "JSON_ARRAY";
  arrayPath: string;
  nameField: string;
  websiteField?: string;
  registrationField?: string;
};
type HtmlParserConfig = {
  type: "HTML_TABLE";
  rowSelector: string;
  nameSelector: string;
  websiteSelector?: string;
  registrationSelector?: string;
  linkSelector?: string;
};
type BraveSearchParserConfig = {
  type: "BRAVE_SEARCH";
  query: string;
  targetProductFamily?: ProductFamily;
  application?: BuyerApplication;
};
type ParserConfig =
  | JsonParserConfig
  | HtmlParserConfig
  | BraveSearchParserConfig;
function at(value: unknown, path: string): unknown {
  return path
    ? path
        .split(".")
        .reduce<unknown>(
          (current, key) =>
            current && typeof current === "object"
              ? (current as Record<string, unknown>)[key]
              : undefined,
          value,
        )
    : value;
}
function safeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function parser(config: ParserConfig): SourceParser {
  if (config.type === "BRAVE_SEARCH")
    throw new Error("Brave search config cannot use HTTP page parser");
  return {
    async parse(input) {
      if (config.type === "JSON_ARRAY") {
        const rows = at(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(input.body),
          ),
          config.arrayPath,
        );
        if (!Array.isArray(rows))
          throw new Error("discovery JSON array missing");
        return {
          links: [],
          candidates: rows.flatMap((row, index) => {
            const name = safeText(at(row, config.nameField));
            if (!name) return [];
            const registration = config.registrationField
              ? safeText(at(row, config.registrationField))
              : undefined;
            return [
              {
                candidateId: `${input.receipt.sha256.slice(0, 20)}-${index}`,
                legalName: name,
                website: config.websiteField
                  ? (safeText(at(row, config.websiteField)) ?? null)
                  : null,
                registrationIdentifier: registration ?? null,
                registrationState: registration
                  ? ("SOURCE_STATED" as const)
                  : ("UNVERIFIED" as const),
                discoveredAt: input.retrievedAt,
              },
            ];
          }),
        };
      }
      const $ = load(
          new TextDecoder("utf-8", { fatal: true }).decode(input.body),
        ),
        links: string[] = [],
        candidates: Awaited<
          ReturnType<SourceParser["parse"]>
        >["candidates"][number][] = [];
      $(config.rowSelector).each((index, element) => {
        const name = $(element).find(config.nameSelector).first().text().trim();
        if (!name) return;
        const website = config.websiteSelector
            ? $(element)
                .find(config.websiteSelector)
                .first()
                .attr("href")
                ?.trim()
            : undefined,
          registration = config.registrationSelector
            ? $(element).find(config.registrationSelector).first().text().trim()
            : undefined;
        candidates.push({
          candidateId: `${input.receipt.sha256.slice(0, 20)}-${index}`,
          legalName: name,
          website: website ?? null,
          registrationIdentifier: registration || null,
          registrationState: registration ? "SOURCE_STATED" : "UNVERIFIED",
          discoveredAt: input.retrievedAt,
        });
      });
      if (config.linkSelector)
        $(config.linkSelector).each((_index, element) => {
          const href = $(element).attr("href");
          if (href) links.push(href);
        });
      return { links, candidates };
    },
  };
}

export class ProductionDiscoveryService {
  constructor(
    readonly pool: Pool,
    readonly store: ImmutableEvidenceStore,
    readonly cipher: SensitiveDataCipher,
    readonly brave?: BraveSearchConnector,
  ) {}
  async run(
    sourceId: string,
    expectedRole: "SUPPLIER" | "BUYER",
  ): Promise<{
    receiptIds: readonly string[];
    candidateCount: number;
    stoppedReason: string;
  }> {
    const source = (
      await this.pool.query(
        "select s.* from discovery_source_configs s join authority_receipts a on a.receipt_id=s.source_policy_receipt_id where s.id=$1 and s.role=$2 and s.state='APPROVED' and s.valid_from<=now() and s.valid_until>now() and a.authority_kind='DISCOVERY_SOURCE_REVIEW' and a.retrieved_at<=now() and a.effective_at<=now() and a.expires_at>now()",
        [sourceId, expectedRole],
      )
    ).rows[0];
    if (!source) throw new Error("reviewed discovery source unavailable");
    if (!/^[A-Z]{2}$/.test(String(source.country_code ?? "")))
      throw new Error("reviewed discovery source country unavailable");
    if (source.source_kind === "SEARCH")
      return this.runBraveSearch(
        source,
        expectedRole,
        source.parser_config as BraveSearchParserConfig,
      );
    const hosts = source.allowed_hosts;
    if (
      !Array.isArray(hosts) ||
      hosts.some((value) => typeof value !== "string")
    )
      throw new Error("discovery hosts invalid");
    const connector = new ReviewedHttpDiscoveryConnector(
        source.source_kind as DiscoverySourceKind,
        {
          sourceAllowed: true,
          robotsAllowed: true,
          termsReviewed: true,
          maxPages: source.maximum_pages,
          allowedHosts: hosts,
        },
        this.store,
        parser(source.parser_config as ParserConfig),
      ),
      result = await connector.harvest(source.seed_url),
      receiptIds: string[] = [];
    await inTransaction(this.pool, async (client) => {
      for (const page of result.pages) {
        let receipt = (
          await client.query(
            "select id from discovery_receipts where canonical_url=$1 and body_sha256=$2",
            [page.canonicalUrl, page.bodySha256],
          )
        ).rows[0];
        if (!receipt)
          receipt = (
            await client.query(
              "insert into discovery_receipts(id,source_kind,canonical_url,retrieved_at,body_sha256,body_object_key,policy_version) values($1,$2,$3,$4,$5,$6,$7) returning id",
              [
                randomUUID(),
                source.source_kind,
                page.canonicalUrl,
                page.retrievedAt,
                page.bodySha256,
                page.bodyObjectKey,
                `source:${source.id}`,
              ],
            )
          ).rows[0];
        receiptIds.push(String(receipt.id));
        for (const candidate of result.candidates.filter(
          (value) => value.sourcePageUrl === page.canonicalUrl,
        )) {
          await this.persistCandidate(
            client,
            receipt.id,
            candidate,
            expectedRole,
            source.country_code,
          );
        }
      }
    });
    await this.enqueueKyb(expectedRole);
    return {
      receiptIds: Object.freeze(receiptIds),
      candidateCount: result.candidates.length,
      stoppedReason: result.stoppedReason,
    };
  }

  private async runBraveSearch(
    source: QueryResultRow,
    expectedRole: "SUPPLIER" | "BUYER",
    config: BraveSearchParserConfig,
  ) {
    if (!this.brave) throw new Error("Brave production search unavailable");
    if (
      config.type !== "BRAVE_SEARCH" ||
      !config.query?.trim() ||
      config.query.length > 500 ||
      (config.targetProductFamily &&
        !PRODUCT_FAMILIES.includes(config.targetProductFamily))
    )
      throw new Error("reviewed Brave search config invalid");
    const evidence = await this.brave.search(config.query),
      receiptIds: string[] = [];
    let candidateCount = 0;
    await inTransaction(this.pool, async (client) => {
      for (const [index, item] of evidence.entries()) {
        const url = new URL(item.sourceUrl);
        if (url.protocol !== "https:")
          throw new Error("Brave result URL must use HTTPS");
        const digest = item.receiptId.split("/").at(-1);
        if (!digest || !/^[0-9a-f]{64}$/.test(digest))
          throw new Error("Brave receipt digest invalid");
        let receipt = (
          await client.query(
            "select id from discovery_receipts where canonical_url=$1 and body_sha256=$2",
            [item.sourceUrl, digest],
          )
        ).rows[0];
        if (!receipt)
          receipt = (
            await client.query(
              "insert into discovery_receipts(id,source_kind,canonical_url,retrieved_at,body_sha256,body_object_key,policy_version) values($1,'SEARCH',$2,$3,$4,$5,$6) returning id",
              [
                randomUUID(),
                item.sourceUrl,
                item.retrievedAt,
                digest,
                item.receiptId,
                `source:${source.id}`,
              ],
            )
          ).rows[0];
        receiptIds.push(String(receipt.id));
        const title = item.text.split("\n", 1)[0]?.trim(),
          candidate: OrganizationCandidate = {
            candidateId: `${digest.slice(0, 20)}-${index}`,
            sourceKind: "SEARCH",
            legalName: title || url.hostname,
            website: url.origin,
            sourcePageUrl: item.sourceUrl,
            sourceBodySha256: digest,
            registrationIdentifier: null,
            registrationState: "UNVERIFIED",
            discoveredAt: item.retrievedAt,
          },
          organizationId = await this.persistCandidate(
            client,
            receipt.id,
            candidate,
            expectedRole,
            source.country_code,
          );
        candidateCount++;
        if (expectedRole === "BUYER")
          await this.persistBuyerProfile(
            client,
            organizationId,
            receipt.id,
            candidate,
            item,
            config,
          );
      }
    });
    await this.enqueueKyb(expectedRole);
    return {
      receiptIds: Object.freeze(receiptIds),
      candidateCount,
      stoppedReason: "COMPLETE",
    };
  }

  private async persistCandidate(
    client: PoolClient,
    receiptId: string,
    candidate: OrganizationCandidate,
    expectedRole: "SUPPLIER" | "BUYER",
    countryCode: string,
  ): Promise<string> {
    let stored = (
      await client.query(
        "select id from organization_candidates where discovery_receipt_id=$1 and legal_name=$2 and coalesce(registration_identifier,'')=coalesce($3,'')",
        [receiptId, candidate.legalName, candidate.registrationIdentifier],
      )
    ).rows[0];
    if (!stored)
      stored = (
        await client.query(
          "insert into organization_candidates(id,discovery_receipt_id,legal_name,website,registration_identifier,registration_state,discovered_at) values($1,$2,$3,$4,$5,$6,$7) returning id",
          [
            randomUUID(),
            receiptId,
            candidate.legalName,
            candidate.website,
            candidate.registrationIdentifier,
            candidate.registrationState,
            candidate.discoveredAt,
          ],
        )
      ).rows[0];
    const domain = candidate.website
        ? new URL(candidate.website).hostname.toLowerCase()
        : null,
      identity = this.cipher.lookup(
        candidate.registrationIdentifier
          ? `registration:${candidate.registrationIdentifier}`
          : domain
            ? `domain:${domain}`
            : `name:${candidate.legalName}`,
      ),
      known = (
        await client.query(
          "select organization_id from organization_identity_keys where identity_hash=$1",
          [identity],
        )
      ).rows[0];
    let organizationId = known?.organization_id;
    if (!organizationId) {
      organizationId = randomUUID();
      await client.query(
        "insert into organizations(id,organization_type,legal_name_ciphertext) values($1,$2,$3)",
        [
          organizationId,
          expectedRole,
          this.cipher.encrypt(candidate.legalName),
        ],
      );
      await client.query(
        "insert into organization_identity_keys(identity_hash,organization_id,candidate_id) values($1,$2,$3)",
        [identity, organizationId, stored.id],
      );
    }
    await client.query(
      "insert into candidate_organizations(candidate_id,organization_id,role) values($1,$2,$3) on conflict(candidate_id) do nothing",
      [stored.id, organizationId, expectedRole],
    );
    await client.query(
      "insert into organization_jurisdictions(organization_id,country_code,source_receipt_id,state,valid_until) values($1,$2,$3,'SOURCE_STATED',now()+interval '90 days') on conflict(organization_id) do update set country_code=excluded.country_code,source_receipt_id=excluded.source_receipt_id,state=excluded.state,valid_until=excluded.valid_until where organization_jurisdictions.country_code=excluded.country_code or organization_jurisdictions.valid_until<=now()",
      [organizationId, countryCode, receiptId],
    );
    if (domain)
      await client.query(
        "insert into enrichment_jobs(id,candidate_id,organization_id,domain,state) values($1,$2,$3,$4,'PENDING') on conflict(candidate_id) do nothing",
        [randomUUID(), stored.id, organizationId, domain],
      );
    return String(organizationId);
  }

  private async persistBuyerProfile(
    client: PoolClient,
    organizationId: string,
    receiptId: string,
    candidate: OrganizationCandidate,
    evidence: AcquisitionEvidence,
    config: BraveSearchParserConfig,
  ): Promise<void> {
    if (!config.targetProductFamily || !config.application) return;
    const node = buildBuyerNode(candidate, [evidence], []),
      expectedSignal = familySignal(config.targetProductFamily);
    if (
      node.classificationState !== "SOURCE_STATED" ||
      !node.applications.includes(config.application) ||
      !node.polymerSignals.includes(expectedSignal)
    )
      return;
    const profile = (
      await client.query(
        "insert into acquisition_profiles(id,organization_id,target_product_family,application,source_receipt_id,classification_state,valid_until) values(gen_random_uuid(),$1,$2,$3,$4,'SOURCE_STATED',now()+interval '30 days') on conflict(organization_id,target_product_family,application) do update set source_receipt_id=excluded.source_receipt_id,classification_state=excluded.classification_state,valid_until=excluded.valid_until returning id",
        [
          organizationId,
          config.targetProductFamily,
          config.application,
          receiptId,
        ],
      )
    ).rows[0];
    await client.query(
      "with adopted as(update acquisition_outreach_jobs set acquisition_profile_id=$2,state='READY',claimed_at=null,last_error_code=null where id=(select id from acquisition_outreach_jobs where organization_id=$1 and acquisition_profile_id is null and state='WAITING_PROFILE' order by created_at limit 1) returning id) insert into acquisition_outreach_jobs(id,organization_id,acquisition_profile_id,state) select gen_random_uuid(),$1,$2,'READY' where not exists(select 1 from adopted) and not exists(select 1 from acquisition_outreach_jobs where organization_id=$1 and acquisition_profile_id=$2)",
      [organizationId, profile.id],
    );
  }

  private enqueueKyb(expectedRole: "SUPPLIER" | "BUYER") {
    return this.pool.query(
      "insert into kyb_jobs(id,organization_id,candidate_id,country_code,state) select gen_random_uuid(),co.organization_id,co.candidate_id,j.country_code,'PENDING' from candidate_organizations co join organization_jurisdictions j on j.organization_id=co.organization_id and j.valid_until>now() where co.role=$1 and not exists(select 1 from kyb_jobs k where k.organization_id=co.organization_id)",
      [expectedRole],
    );
  }
}

function familySignal(family: ProductFamily): PolymerSignal {
  if (family.startsWith("RPP_")) return "RPP";
  if (family.startsWith("RHDPE_")) return "RHDPE";
  if (family === "RLLDPE_LDPE_FILM") return "RLDPE_LLDPE";
  if (family === "PP_PRIME_NON_PRIME") return "PP";
  if (family === "HDPE_PRIME_NON_PRIME") return "HDPE";
  return "LLDPE";
}
