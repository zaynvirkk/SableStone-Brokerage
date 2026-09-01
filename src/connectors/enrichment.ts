import { createHash } from "node:crypto";
import type { ContactRecord, ContactSource } from "../contacts.js";
import type { ReceiptWriter } from "./discovery_http.js";
import type { CredentialUseGuard } from "../runtime/production_credentials.js";
import type { AuthorityUseGuard } from "../runtime/authority_receipts.js";
export interface EnrichmentApproval {
  readonly provider: "HUNTER" | "APOLLO";
  readonly state: "APPROVED" | "UNDER_REVIEW" | "REVOKED";
  readonly credentialSecret: string | null;
  readonly lawfulBasisPolicyVersion: string;
  readonly jurisdiction: string;
  readonly expiresAt: string;
}
export class HunterContactConnector {
  constructor(
    readonly approval: EnrichmentApproval,
    readonly store: ReceiptWriter,
    readonly fetcher: typeof fetch = fetch,
    readonly credentialGuard?: CredentialUseGuard,
    readonly authorityGuard?: AuthorityUseGuard,
  ) {}
  async domainSearch(
    domain: string,
    organizationId: string,
    now = new Date().toISOString(),
  ): Promise<readonly ContactRecord[]> {
    await this.authorityGuard?.assertCurrent();
    await this.credentialGuard?.assertCurrent();
    if (
      this.approval.provider !== "HUNTER" ||
      this.approval.state !== "APPROVED" ||
      !this.approval.credentialSecret ||
      Date.parse(now) >= Date.parse(this.approval.expiresAt)
    )
      throw new Error("Hunter capability unavailable");
    if (!/^[a-z0-9.-]+$/i.test(domain)) throw new Error("domain invalid");
    const url = new URL("https://api.hunter.io/v2/domain-search");
    url.searchParams.set("domain", domain);
    url.searchParams.set("api_key", this.approval.credentialSecret);
    const response = await this.fetcher(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      }),
      body = new Uint8Array(await response.arrayBuffer()),
      receipt = await this.store.preserve(
        "enrichment/hunter",
        body,
        response.headers.get("content-type") ?? "application/json",
        url.origin + url.pathname,
        now,
      );
    if (!response.ok)
      throw new Error(
        `Hunter HTTP ${response.status}; receipt=${receipt.objectKey}`,
      );
    const decoded = JSON.parse(new TextDecoder().decode(body)) as {
      data?: {
        emails?: {
          value?: string;
          verification?: { status?: string };
          sources?: unknown[];
        }[];
      };
    };
    return Object.freeze(
      (decoded.data?.emails ?? []).flatMap((item, index) => {
        if (!item.value) return [];
        const verified = item.verification?.status === "valid";
        return [
          Object.freeze({
            contactId: createHash("sha256")
              .update(`${organizationId}:${item.value}`)
              .digest("hex")
              .slice(0, 32),
            organizationId,
            email: item.value,
            source: "HUNTER" as ContactSource,
            sourceReceiptId: receipt.objectKey,
            verification: verified
              ? ("VERIFIED" as const)
              : ("UNVERIFIED" as const),
            verifiedAt: verified ? now : null,
            lawfulBasisPolicyVersion: this.approval.lawfulBasisPolicyVersion,
            jurisdiction: this.approval.jurisdiction,
          }),
        ];
      }),
    );
  }
}
