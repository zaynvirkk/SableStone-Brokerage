import type { ReceiptWriter } from "./discovery_http.js";
import type { CredentialUseGuard } from "../runtime/production_credentials.js";
import type { AuthorityUseGuard } from "../runtime/authority_receipts.js";
export type KybOutcome = "VERIFIED" | "FAILED" | "UNKNOWN" | "CONFLICTING";
export interface KybResult {
  readonly provider: string;
  readonly externalReference: string;
  readonly outcome: KybOutcome;
  readonly organizationName: string;
  readonly registrationIdentifier: string | null;
  readonly watchlistHit: boolean | null;
  readonly receiptId: string;
  readonly checkedAt: string;
}
export interface KybProviderConfig {
  readonly provider: string;
  readonly state: "APPROVED" | "UNDER_REVIEW" | "REVOKED";
  readonly baseUrl: string;
  readonly verificationPath: string;
  readonly authorizationHeader: string;
  readonly exactUseCaseReceiptId: string;
  readonly validUntil: string;
}
export class ProductionKybConnector {
  constructor(
    readonly config: KybProviderConfig,
    readonly store: ReceiptWriter,
    readonly fetcher: typeof fetch = fetch,
    readonly credentialGuard?: CredentialUseGuard,
    readonly authorityGuard?: AuthorityUseGuard,
  ) {}
  async verify(
    input: {
      organizationName: string;
      countryCode: string;
      registrationIdentifier: string | null;
    },
    now = new Date().toISOString(),
  ): Promise<KybResult> {
    await this.authorityGuard?.assertCurrent();
    await this.credentialGuard?.assertCurrent();
    if (
      this.config.state !== "APPROVED" ||
      !this.config.authorizationHeader ||
      !this.config.exactUseCaseReceiptId ||
      Date.parse(now) >= Date.parse(this.config.validUntil)
    )
      throw new Error("KYB capability unavailable");
    if (!input.organizationName.trim() || !/^[A-Z]{2}$/.test(input.countryCode))
      throw new Error("KYB input invalid");
    const url = new URL(this.config.verificationPath, this.config.baseUrl),
      payload = JSON.stringify(input),
      requestReceipt = await this.store.preserve(
        `kyb/${this.config.provider}/request`,
        new TextEncoder().encode(payload),
        "application/json",
        url.toString(),
        now,
      ),
      response = await this.fetcher(url, {
        method: "POST",
        headers: {
          authorization: this.config.authorizationHeader,
          "content-type": "application/json",
        },
        body: payload,
        signal: AbortSignal.timeout(30_000),
      }),
      bytes = new Uint8Array(await response.arrayBuffer()),
      receipt = await this.store.preserve(
        `kyb/${this.config.provider}/response`,
        bytes,
        response.headers.get("content-type") ?? "application/json",
        url.toString(),
        now,
      );
    if (!response.ok)
      throw new Error(
        `KYB HTTP ${response.status}; request=${requestReceipt.objectKey}; response=${receipt.objectKey}`,
      );
    const data = JSON.parse(new TextDecoder().decode(bytes)) as {
      reference?: string;
      status?: string;
      organizationName?: string;
      registrationIdentifier?: string | null;
      watchlistHit?: boolean | null;
    };
    if (!data.reference || !data.organizationName)
      throw new Error("KYB response incomplete");
    const outcome: KybOutcome =
      data.status === "VERIFIED"
        ? "VERIFIED"
        : data.status === "FAILED"
          ? "FAILED"
          : data.status === "CONFLICTING"
            ? "CONFLICTING"
            : "UNKNOWN";
    return Object.freeze({
      provider: this.config.provider,
      externalReference: data.reference,
      outcome,
      organizationName: data.organizationName,
      registrationIdentifier: data.registrationIdentifier ?? null,
      watchlistHit: data.watchlistHit ?? null,
      receiptId: receipt.objectKey,
      checkedAt: now,
    });
  }
}
export interface CslScreeningResult {
  readonly state: "CLEAR" | "POTENTIAL_HIT" | "UNKNOWN";
  readonly matches: number | null;
  readonly receiptId: string;
  readonly checkedAt: string;
}
export class ConsolidatedScreeningListConnector {
  constructor(
    readonly reviewedEndpoint: string,
    readonly store: ReceiptWriter,
    readonly fetcher: typeof fetch = fetch,
  ) {}
  async screen(
    name: string,
    now = new Date().toISOString(),
  ): Promise<CslScreeningResult> {
    const url = new URL(this.reviewedEndpoint);
    if (url.protocol !== "https:" || !url.hostname.endsWith("trade.gov"))
      throw new Error("CSL endpoint unreviewed");
    url.searchParams.set("name", name);
    const response = await this.fetcher(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      }),
      bytes = new Uint8Array(await response.arrayBuffer()),
      receipt = await this.store.preserve(
        "screening/csl",
        bytes,
        response.headers.get("content-type") ?? "application/json",
        url.origin + url.pathname,
        now,
      );
    if (!response.ok)
      return Object.freeze({
        state: "UNKNOWN",
        matches: null,
        receiptId: receipt.objectKey,
        checkedAt: now,
      });
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as {
      total?: number;
    };
    if (!Number.isSafeInteger(decoded.total) || decoded.total === undefined)
      return Object.freeze({
        state: "UNKNOWN",
        matches: null,
        receiptId: receipt.objectKey,
        checkedAt: now,
      });
    return Object.freeze({
      state: decoded.total === 0 ? "CLEAR" : "POTENTIAL_HIT",
      matches: decoded.total,
      receiptId: receipt.objectKey,
      checkedAt: now,
    });
  }
}
