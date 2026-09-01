import { createHash } from "node:crypto";
import {
  addDecimal,
  decimal,
  multiplyDecimal,
  type DecimalString,
} from "../money.js";
import type { OrganizationCandidate } from "../discovery.js";
import type { ContactRecord } from "../contacts.js";
import type { ReceiptWriter } from "./discovery_http.js";
import type { CredentialUseGuard } from "../runtime/production_credentials.js";
import type { AuthorityUseGuard } from "../runtime/authority_receipts.js";
import { readBoundedResponseBody } from "../runtime/public_network.js";
export type PolymerSignal =
  | "RPP"
  | "RHDPE"
  | "RLDPE_LLDPE"
  | "PP"
  | "HDPE"
  | "LLDPE";
export type BuyerApplication =
  | "RIGID_PACKAGING"
  | "FLEXIBLE_PACKAGING"
  | "INJECTION_MOULDING"
  | "BLOW_MOULDING"
  | "FILM_EXTRUSION"
  | "UNKNOWN";
export interface AcquisitionEvidence {
  readonly receiptId: string;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly text: string;
}
export interface SupplierGraphNode {
  readonly organization: OrganizationCandidate;
  readonly polymerSignals: readonly PolymerSignal[];
  readonly classificationState: "SOURCE_STATED" | "UNKNOWN";
  readonly evidenceReceiptIds: readonly string[];
  readonly contacts: readonly ContactRecord[];
}
export interface BuyerGraphNode {
  readonly organization: OrganizationCandidate;
  readonly applications: readonly BuyerApplication[];
  readonly polymerSignals: readonly PolymerSignal[];
  readonly tonnesPerMonth: DecimalString | null;
  readonly recycledPressure: DecimalString | null;
  readonly classificationState: "SOURCE_STATED" | "UNKNOWN";
  readonly evidenceReceiptIds: readonly string[];
  readonly contacts: readonly ContactRecord[];
}
const polymerPatterns: readonly [PolymerSignal, RegExp][] = [
  ["RPP", /\b(?:recycled\s+pp|rpp)\b/i],
  ["RHDPE", /\b(?:recycled\s+hdpe|rhdpe)\b/i],
  ["RLDPE_LLDPE", /\b(?:recycled\s+(?:ldpe|lldpe)|rldpe|rlldpe)\b/i],
  ["PP", /\bpolypropylene|\bpp\b/i],
  ["HDPE", /\bhigh.density polyethylene|\bhdpe\b/i],
  ["LLDPE", /\blinear low.density polyethylene|\blldpe\b/i],
];
const applicationPatterns: readonly [BuyerApplication, RegExp][] = [
  [
    "RIGID_PACKAGING",
    /rigid packaging|pail|bucket|cap|closure|industrial container/i,
  ],
  ["FLEXIBLE_PACKAGING", /flexible packaging|pouch|laminate/i],
  ["INJECTION_MOULDING", /injection mould/i],
  ["BLOW_MOULDING", /blow mould/i],
  ["FILM_EXTRUSION", /film extrusion|blown film/i],
];
function signals(
  evidence: readonly AcquisitionEvidence[],
): readonly PolymerSignal[] {
  const text = evidence.map((item) => item.text).join("\n");
  return Object.freeze(
    polymerPatterns
      .filter(([, pattern]) => pattern.test(text))
      .map(([name]) => name),
  );
}
export function buildSupplierNode(
  organization: OrganizationCandidate,
  evidence: readonly AcquisitionEvidence[],
  contacts: readonly ContactRecord[],
): SupplierGraphNode {
  const polymerSignals = signals(evidence);
  return Object.freeze({
    organization,
    polymerSignals,
    classificationState: polymerSignals.length ? "SOURCE_STATED" : "UNKNOWN",
    evidenceReceiptIds: Object.freeze(evidence.map((item) => item.receiptId)),
    contacts: Object.freeze([...contacts]),
  });
}
export function buildBuyerNode(
  organization: OrganizationCandidate,
  evidence: readonly AcquisitionEvidence[],
  contacts: readonly ContactRecord[],
  declared: {
    tonnesPerMonth: DecimalString | null;
    recycledPressure: DecimalString | null;
  } = { tonnesPerMonth: null, recycledPressure: null },
): BuyerGraphNode {
  const text = evidence.map((item) => item.text).join("\n"),
    applications = applicationPatterns
      .filter(([, pattern]) => pattern.test(text))
      .map(([name]) => name),
    polymerSignals = signals(evidence),
    effectiveApplications: readonly BuyerApplication[] = applications.length
      ? applications
      : ["UNKNOWN"];
  return Object.freeze({
    organization,
    applications: Object.freeze(effectiveApplications),
    polymerSignals,
    tonnesPerMonth: declared.tonnesPerMonth,
    recycledPressure: declared.recycledPressure,
    classificationState:
      applications.length || polymerSignals.length
        ? "SOURCE_STATED"
        : "UNKNOWN",
    evidenceReceiptIds: Object.freeze(evidence.map((item) => item.receiptId)),
    contacts: Object.freeze([...contacts]),
  });
}
export function expectedBuyerRelationshipValue(
  node: BuyerGraphNode,
  inventoryCompatibility: DecimalString,
  expectedCommissionPerKg: DecimalString,
  responseProbability: DecimalString,
): DecimalString | null {
  if (node.tonnesPerMonth === null || node.recycledPressure === null)
    return null;
  const kg = multiplyDecimal(node.tonnesPerMonth, decimal("1000"));
  return multiplyDecimal(
    multiplyDecimal(
      multiplyDecimal(
        multiplyDecimal(kg, node.recycledPressure),
        inventoryCompatibility,
      ),
      expectedCommissionPerKg,
    ),
    responseProbability,
  );
}
export interface SearchApproval {
  readonly provider: "BRAVE";
  readonly state: "APPROVED" | "UNDER_REVIEW" | "REVOKED";
  readonly apiKey: string | null;
  readonly expiresAt: string;
  readonly maximumResults: number;
  readonly approvalReceiptId?: string;
}
export class BraveSearchConnector {
  constructor(
    readonly approval: SearchApproval,
    readonly store: ReceiptWriter,
    readonly fetcher: typeof fetch = fetch,
    readonly credentialGuard?: CredentialUseGuard,
    readonly authorityGuard?: AuthorityUseGuard,
  ) {}
  async search(
    query: string,
    now = new Date().toISOString(),
  ): Promise<readonly AcquisitionEvidence[]> {
    await this.authorityGuard?.assertCurrent();
    await this.credentialGuard?.assertCurrent();
    if (
      this.approval.state !== "APPROVED" ||
      !this.approval.apiKey ||
      Date.parse(now) >= Date.parse(this.approval.expiresAt)
    )
      throw new Error("Brave capability unavailable");
    if (
      !query.trim() ||
      this.approval.maximumResults < 1 ||
      this.approval.maximumResults > 20
    )
      throw new Error("search bounds invalid");
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(this.approval.maximumResults));
    const response = await this.fetcher(url, {
        headers: {
          accept: "application/json",
          "x-subscription-token": this.approval.apiKey,
        },
        signal: AbortSignal.timeout(15_000),
      }),
      bytes = await readBoundedResponseBody(response, 2_000_000),
      receipt = await this.store.preserve(
        "search/brave",
        bytes,
        response.headers.get("content-type") ?? "application/json",
        url.origin + url.pathname,
        now,
      );
    if (!response.ok)
      throw new Error(
        `Brave HTTP ${response.status}; receipt=${receipt.objectKey}`,
      );
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as {
      web?: {
        results?: { url?: string; title?: string; description?: string }[];
      };
    };
    return Object.freeze(
      (decoded.web?.results ?? []).flatMap((item) =>
        item.url
          ? [
              Object.freeze({
                receiptId: receipt.objectKey,
                sourceUrl: item.url,
                retrievedAt: now,
                text: `${item.title ?? ""}\n${item.description ?? ""}`,
              }),
            ]
          : [],
      ),
    );
  }
}
export function acquisitionNodeId(
  organizationId: string,
  evidenceIds: readonly string[],
): string {
  return createHash("sha256")
    .update(`${organizationId}:${[...evidenceIds].sort().join(":")}`)
    .digest("hex");
}
