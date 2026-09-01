import type { CostKind } from "../costs.js";
import { decimal, type DecimalString } from "../money.js";
import type { ReceiptWriter } from "./discovery_http.js";
import type { CredentialUseGuard } from "../runtime/production_credentials.js";
import type { AuthorityUseGuard } from "../runtime/authority_receipts.js";

export type QuotedCostKind = Exclude<CostKind, "SUPPLIER_NET">;
export interface EconomicQuoteHttpConfig {
  readonly provider: string;
  readonly costKinds: readonly QuotedCostKind[];
  readonly baseUrl: string;
  readonly quotePath: string;
  readonly authorizationHeader: string;
  readonly approvalReceiptId: string;
  readonly validUntil: string;
}
export interface EconomicQuote {
  readonly provider: string;
  readonly externalReference: string;
  readonly costKind: QuotedCostKind;
  readonly amountPerKg: DecimalString;
  readonly currency: string;
  readonly validUntil: string;
  readonly requestObjectKey: string;
  readonly responseObjectKey: string;
  readonly responseSha256: string;
}
export class ProductionEconomicQuoteConnector {
  constructor(
    readonly config: EconomicQuoteHttpConfig,
    readonly store: ReceiptWriter,
    readonly fetcher: typeof fetch = fetch,
    readonly credentialGuard?: CredentialUseGuard,
    readonly authorityGuard?: AuthorityUseGuard,
  ) {
    if (
      !config.provider ||
      !config.costKinds.length ||
      !config.baseUrl.startsWith("https://") ||
      !config.authorizationHeader ||
      !config.approvalReceiptId ||
      Date.parse(config.validUntil) <= Date.now()
    )
      throw new Error("economic quote provider unavailable");
  }
  async quote(input: {
    matchId: string;
    costKind: QuotedCostKind;
    productFamily: string;
    quantityMt: string;
    offerSpec: unknown;
    demandSpec: unknown;
    currency: string;
  }): Promise<EconomicQuote> {
    await this.authorityGuard?.assertCurrent();
    await this.credentialGuard?.assertCurrent();
    if (
      !this.config.costKinds.includes(input.costKind) ||
      Date.parse(this.config.validUntil) <= Date.now()
    )
      throw new Error("economic quote capability unavailable");
    const url = new URL(this.config.quotePath, this.config.baseUrl),
      payload = JSON.stringify(input),
      request = await this.store.preserve(
        `economics/${this.config.provider}/request`,
        new TextEncoder().encode(payload),
        "application/json",
        url.toString(),
      ),
      response = await this.fetcher(url, {
        method: "POST",
        headers: {
          authorization: this.config.authorizationHeader,
          "content-type": "application/json",
          "idempotency-key": `${input.matchId}:${input.costKind}`,
        },
        body: payload,
        signal: AbortSignal.timeout(30_000),
      }),
      bytes = new Uint8Array(await response.arrayBuffer()),
      receipt = await this.store.preserve(
        `economics/${this.config.provider}/response`,
        bytes,
        response.headers.get("content-type") ?? "application/json",
        url.toString(),
      );
    if (!response.ok) throw new Error(`economic quote HTTP ${response.status}`);
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as {
      externalReference?: string;
      costKind?: QuotedCostKind;
      amountPerKg?: string;
      currency?: string;
      validUntil?: string;
      firm?: boolean;
    };
    if (
      decoded.firm !== true ||
      !decoded.externalReference?.trim() ||
      decoded.costKind !== input.costKind ||
      decoded.currency !== input.currency ||
      !decoded.validUntil ||
      Date.parse(decoded.validUntil) <= Date.now()
    )
      throw new Error("economic quote response incomplete");
    const amount = decimal(String(decoded.amountPerKg));
    if (amount.startsWith("-")) throw new Error("economic quote negative");
    return Object.freeze({
      provider: this.config.provider,
      externalReference: decoded.externalReference,
      costKind: decoded.costKind,
      amountPerKg: amount,
      currency: decoded.currency,
      validUntil: decoded.validUntil,
      requestObjectKey: request.objectKey,
      responseObjectKey: receipt.objectKey,
      responseSha256: receipt.sha256,
    });
  }
}
