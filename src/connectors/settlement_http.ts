import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { addDecimal, decimal } from "../money.js";
import type {
  ProviderCapabilitySnapshot,
  SettlementAdapter,
  SettlementCapability,
  SettlementEnvironment,
  SettlementInstructionDraft,
} from "../settlement.js";
import {
  assertAdapterAvailable,
  assertSettlementInstruction,
  evaluateProviderCapability,
  requiredSettlementCapabilities,
  type ProviderApproval,
  type ProviderCredentials,
} from "../settlement.js";
import type { ReceiptWriter } from "./discovery_http.js";
import type { CredentialUseGuard } from "../runtime/production_credentials.js";
import type { AuthorityUseGuard } from "../runtime/authority_receipts.js";
import {
  createPinnedPublicFetch,
  readBoundedResponseBody,
  resolveExternalProviderEndpoint,
} from "../runtime/public_network.js";

type InternalEvent =
  | "ENTITLEMENT_SECURED"
  | "FUNDED"
  | "DISBURSEMENT_REPORTED"
  | "FAILED"
  | "REVERSED"
  | "DISPUTE_OPENED"
  | "DISPUTE_RESOLVED_BUYER"
  | "DISPUTE_RESOLVED_SUPPLIER"
  | "REFUNDED";
export interface ProviderHttpConfig {
  readonly provider: string;
  readonly baseUrl: string;
  readonly createPath: string;
  readonly cashfreeSplitPathTemplate?: string;
  readonly cashfreeSplitVerificationPathTemplate?: string;
  readonly cashfreeSettlementEligibilityPathTemplate?: string;
  readonly razorpayTransferPathTemplate?: string;
  readonly razorpayTransferReleasePathTemplate?: string;
  readonly authorizationHeader: string;
  readonly additionalHeaders: Readonly<Record<string, string>>;
  readonly webhookSecret: string;
  readonly webhookSignatureHeader?: string;
  readonly webhookTimestampHeader?: string;
  readonly webhookEventIdPath?: string;
  readonly webhookEventTypePath?: string;
  readonly webhookProviderReferencePath?: string;
  readonly webhookPaymentReferencePath?: string;
  readonly webhookOccurredAtPath?: string;
  readonly webhookAmountPath?: string;
  readonly webhookCurrencyPath?: string;
  readonly webhookBankReferencePath?: string;
  readonly webhookSablestoneBeneficiaryPath?: string;
  readonly webhookSupplierBeneficiaryPath?: string;
  readonly webhookSablestoneAmountPath?: string;
  readonly webhookSupplierAmountPath?: string;
  readonly webhookEventTypeMap?: Readonly<Record<string, InternalEvent>>;
  readonly responseReferenceField: string;
  readonly responseAcknowledgedField: string;
  readonly responseFundingTokenField?: string;
  readonly disputeCreatePathTemplate?: string;
  readonly disputeResponseReferenceField?: string;
}
export type SettlementRequestBuilder = (
  draft: SettlementInstructionDraft,
) => Readonly<Record<string, unknown>>;

export class ProductionSettlementHttpAdapter implements SettlementAdapter {
  readonly environment: SettlementEnvironment = "PRODUCTION";
  constructor(
    readonly provider: string,
    readonly approval: ProviderApproval,
    readonly credentials: ProviderCredentials,
    readonly config: ProviderHttpConfig,
    readonly buildRequest: SettlementRequestBuilder,
    readonly store: ReceiptWriter,
    readonly fetcher: typeof fetch = createPinnedPublicFetch(),
    readonly apiCredentialGuard?: CredentialUseGuard,
    readonly webhookCredentialGuard?: CredentialUseGuard,
    readonly authorityGuard?: AuthorityUseGuard,
  ) {
    if (
      provider !== approval.provider ||
      provider !== credentials.provider ||
      provider !== config.provider
    )
      throw new Error("settlement provider configuration mismatch");
    resolveExternalProviderEndpoint(config.baseUrl, config.createPath);
  }
  capability(
    required: readonly SettlementCapability[],
    now: string,
  ): ProviderCapabilitySnapshot {
    return evaluateProviderCapability(
      this.approval,
      this.credentials,
      required,
      now,
    );
  }
  async createInstruction(draft: SettlementInstructionDraft, now: string) {
    await this.authorityGuard?.assertCurrent();
    await this.apiCredentialGuard?.assertCurrent();
    const snapshot = this.capability(
      requiredSettlementCapabilities(this.provider),
      now,
    );
    assertAdapterAvailable(snapshot);
    assertSettlementInstruction(draft, this.approval, now);
    if (draft.environment !== "PRODUCTION")
      throw new Error("production adapter requires production draft");
    const url = resolveExternalProviderEndpoint(
        this.config.baseUrl,
        this.config.createPath,
      ),
      payload = JSON.stringify(this.buildRequest(draft)),
      requestReceipt = await this.store.preserve(
        `settlement/${this.provider}/request`,
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
          "idempotency-key": draft.idempotencyKey,
          ...this.config.additionalHeaders,
        },
        body: payload,
        signal: AbortSignal.timeout(30_000),
      }),
      bytes = await readBoundedResponseBody(response, 2_000_000),
      responseReceipt = await this.store.preserve(
        `settlement/${this.provider}/response`,
        bytes,
        response.headers.get("content-type") ?? "application/json",
        url.toString(),
        now,
      );
    if (!response.ok)
      throw new Error(
        `${this.provider} HTTP ${response.status}; request=${requestReceipt.objectKey}; response=${responseReceipt.objectKey}`,
      );
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as Record<
        string,
        unknown
      >,
      reference = field(decoded, this.config.responseReferenceField),
      acknowledged = field(decoded, this.config.responseAcknowledgedField),
      fundingToken = this.config.responseFundingTokenField
        ? field(decoded, this.config.responseFundingTokenField)
        : undefined;
    if (
      (typeof reference !== "string" && typeof reference !== "number") ||
      !String(reference).trim() ||
      acknowledged !== true
    )
      throw new Error(
        `${this.provider} instruction acknowledgement incomplete; response=${responseReceipt.objectKey}`,
      );
    // Creation acknowledgement is not entitlement security.
    return Object.freeze({
      state: "CREATED" as const,
      providerReference: String(reference),
      acknowledged: true,
      ...(typeof fundingToken === "string" && fundingToken.trim()
        ? { fundingToken }
        : {}),
    });
  }
  async verifyWebhook(
    raw: Uint8Array,
    headers: Readonly<Record<string, string | undefined>>,
  ): Promise<Uint8Array> {
    await this.authorityGuard?.assertCurrent();
    await (
      this.provider === "ESCROW_COM"
        ? this.apiCredentialGuard
        : this.webhookCredentialGuard
    )?.assertCurrent();
    if (this.provider === "ESCROW_COM") {
      if (!this.config.webhookProviderReferencePath)
        throw new Error("Escrow webhook reference path missing");
      const decoded = JSON.parse(new TextDecoder().decode(raw)) as Record<
          string,
          unknown
        >,
        reference = field(decoded, this.config.webhookProviderReferencePath);
      if (
        (typeof reference !== "string" && typeof reference !== "number") ||
        !String(reference).trim()
      )
        throw new Error("Escrow webhook reference missing");
      const url = resolveExternalProviderEndpoint(
          this.config.baseUrl,
          `/2017-09-01/transaction/${encodeURIComponent(String(reference))}`,
        ),
        response = await this.fetcher(url, {
          headers: {
            authorization: this.config.authorizationHeader,
            ...this.config.additionalHeaders,
          },
          signal: AbortSignal.timeout(30_000),
        }),
        bytes = await readBoundedResponseBody(response, 2_000_000);
      await this.store.preserve(
        "settlement/ESCROW_COM/webhook-confirmation",
        bytes,
        response.headers.get("content-type") ?? "application/json",
        url.toString(),
        new Date().toISOString(),
      );
      if (!response.ok)
        throw new Error(
          `Escrow transaction confirmation HTTP ${response.status}`,
        );
      const confirmed = JSON.parse(new TextDecoder().decode(bytes)) as Record<
        string,
        unknown
      >;
      if (String(confirmed.id) !== String(reference))
        throw new Error("Escrow transaction confirmation mismatch");
      const items = Array.isArray(confirmed.items) ? confirmed.items : [],
        secured =
          items.length >= 2 &&
          items.every((item) => {
            const schedules = (item as { schedule?: unknown[] }).schedule ?? [];
            return (
              schedules.length > 0 &&
              schedules.every(
                (schedule) =>
                  (schedule as { status?: { secured?: boolean } }).status
                    ?.secured === true,
              )
            );
          }),
        merchandise = items.find(
          (item) => (item as { type?: string }).type === "general_merchandise",
        ) as
          | { schedule?: { beneficiary_customer?: string; amount?: string }[] }
          | undefined,
        brokerFee = items.find(
          (item) => (item as { type?: string }).type === "broker_fee",
        ) as
          | { schedule?: { beneficiary_customer?: string; amount?: string }[] }
          | undefined,
        sellerSchedule = merchandise?.schedule?.[0],
        brokerSchedule = brokerFee?.schedule?.[0],
        supplierAmount = exactProviderDecimal(sellerSchedule?.amount),
        brokerAmount = exactProviderDecimal(brokerSchedule?.amount),
        grossAmount =
          supplierAmount && brokerAmount
            ? addDecimal(supplierAmount, brokerAmount)
            : null;
      return new TextEncoder().encode(
        JSON.stringify({
          ...confirmed,
          sablestone_event_type: secured ? "FUNDS_SECURED" : "PENDING",
          sablestone_verified_at: new Date().toISOString(),
          sablestone_supplier_beneficiary:
            sellerSchedule?.beneficiary_customer ?? null,
          sablestone_broker_beneficiary:
            brokerSchedule?.beneficiary_customer ?? null,
          sablestone_supplier_amount: supplierAmount,
          sablestone_broker_amount: brokerAmount,
          sablestone_gross_amount: grossAmount,
          sablestone_currency: String(confirmed.currency ?? "").toUpperCase(),
        }),
      );
    }
    const signatureName = (
        this.config.webhookSignatureHeader ??
        (this.provider === "CASHFREE_EASY_SPLIT"
          ? "x-webhook-signature"
          : "x-razorpay-signature")
      ).toLowerCase(),
      signature = headers[signatureName];
    if (!signature || !this.config.webhookSecret)
      throw new Error("settlement webhook signature missing");
    if (this.provider === "CASHFREE_EASY_SPLIT") {
      const timestamp =
        headers[
          (
            this.config.webhookTimestampHeader ?? "x-webhook-timestamp"
          ).toLowerCase()
        ];
      if (!timestamp || !/^\d+$/.test(timestamp))
        throw new Error("Cashfree webhook timestamp missing");
      const expected = createHmac("sha256", this.config.webhookSecret)
        .update(timestamp)
        .update(raw)
        .digest("base64");
      if (!safeEqual(signature, expected))
        throw new Error("Cashfree webhook signature invalid");
      return raw;
    }
    if (!/^[0-9a-f]+$/i.test(signature))
      throw new Error("settlement webhook signature malformed");
    const expected = createHmac("sha256", this.config.webhookSecret)
        .update(raw)
        .digest(),
      supplied = Buffer.from(signature, "hex");
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new Error("settlement webhook signature invalid");
    return raw;
  }
  async openDispute(input:Readonly<{providerReference:string;disputeId:string;reason:string;evidenceReceiptId:string|null}>,now:string):Promise<Readonly<{receiptSha256:string;providerDisputeReference:string}>>{
    await this.authorityGuard?.assertCurrent();await this.apiCredentialGuard?.assertCurrent();
    if(!this.config.disputeCreatePathTemplate?.includes("{provider_reference}")||!this.config.disputeResponseReferenceField)throw new Error("provider dispute API unavailable");
    const path=this.config.disputeCreatePathTemplate.replace("{provider_reference}",encodeURIComponent(input.providerReference)),url=resolveExternalProviderEndpoint(this.config.baseUrl,path),body=JSON.stringify({dispute_id:input.disputeId,reason:input.reason,evidence_receipt_id:input.evidenceReceiptId}),response=await this.fetcher(url,{method:"POST",headers:{authorization:this.config.authorizationHeader,"content-type":"application/json","idempotency-key":`dispute:${input.disputeId}`,...this.config.additionalHeaders},body,signal:AbortSignal.timeout(30_000)}),bytes=await readBoundedResponseBody(response,2_000_000),receipt=await this.store.preserve(`settlement/${this.provider}/disputes`,bytes,response.headers.get("content-type")??"application/json",url.toString(),now);
    if(!response.ok)throw new Error(`${this.provider} dispute HTTP ${response.status}; response=${receipt.objectKey}`);
    const decoded=JSON.parse(new TextDecoder().decode(bytes)) as Record<string,unknown>,reference=field(decoded,this.config.disputeResponseReferenceField);if((typeof reference!=="string"&&typeof reference!=="number")||!String(reference).trim())throw new Error("provider dispute acknowledgement incomplete");
    return Object.freeze({receiptSha256:receipt.sha256,providerDisputeReference:String(reference)});
  }
  async applyCashfreeCapturedSplit(
    draft: SettlementInstructionDraft,
    now: string,
  ): Promise<{ receiptSha256: string; providerPayoutReference: string }> {
    await this.authorityGuard?.assertCurrent();
    await this.apiCredentialGuard?.assertCurrent();
    if (this.provider !== "CASHFREE_EASY_SPLIT")
      throw new Error("Cashfree split unavailable for provider");
    if (!this.config.cashfreeSplitPathTemplate?.includes("{order_id}"))
      throw new Error("Cashfree split path unavailable");
    if (
      !this.config.cashfreeSplitVerificationPathTemplate?.includes("{order_id}")
    )
      throw new Error("Cashfree split verification path unavailable");
    const url = resolveExternalProviderEndpoint(
        this.config.baseUrl,
        this.config.cashfreeSplitPathTemplate.replace(
          "{order_id}",
          encodeURIComponent(draft.instructionId),
        ),
      ),
      payload = JSON.stringify(cashfreeSplitRequest(draft)),
      requestReceipt = await this.store.preserve(
        "settlement/CASHFREE_EASY_SPLIT/split-request",
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
          "x-idempotency-key": draft.instructionId,
          ...this.config.additionalHeaders,
        },
        body: payload,
        signal: AbortSignal.timeout(30_000),
      }),
      bytes = await readBoundedResponseBody(response, 2_000_000),
      receipt = await this.store.preserve(
        "settlement/CASHFREE_EASY_SPLIT/split-response",
        bytes,
        response.headers.get("content-type") ?? "application/json",
        url.toString(),
        now,
      );
    if (!response.ok)
      throw new Error(
        `Cashfree split HTTP ${response.status}; request=${requestReceipt.objectKey}; response=${receipt.objectKey}`,
      );
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
    if (decoded.status !== "OK" || decoded.message !== "Order split created")
      throw new Error(
        `Cashfree split acknowledgement incomplete; response=${receipt.objectKey}`,
      );
    const verificationUrl = resolveExternalProviderEndpoint(
        this.config.baseUrl,
        this.config.cashfreeSplitVerificationPathTemplate.replace(
          "{order_id}",
          encodeURIComponent(draft.instructionId),
        ),
      ),
      verificationResponse = await this.fetcher(verificationUrl, {
        headers: {
          authorization: this.config.authorizationHeader,
          ...this.config.additionalHeaders,
        },
        signal: AbortSignal.timeout(30_000),
      }),
      verificationBytes = new Uint8Array(
        await verificationResponse.arrayBuffer(),
      ),
      verificationReceipt = await this.store.preserve(
        "settlement/CASHFREE_EASY_SPLIT/split-verification",
        verificationBytes,
        verificationResponse.headers.get("content-type") ?? "application/json",
        verificationUrl.toString(),
        now,
      );
    if (!verificationResponse.ok)
      throw new Error(
        `Cashfree split verification HTTP ${verificationResponse.status}; response=${verificationReceipt.objectKey}`,
      );
    assertCashfreeSplitVerification(
      JSON.parse(new TextDecoder().decode(verificationBytes)),
      draft,
    );
    return {
      receiptSha256: createHash("sha256")
        .update(receipt.sha256)
        .update(verificationReceipt.sha256)
        .digest("hex"),
      providerPayoutReference: providerReference(
        draft.providerParties.supplier,
        "vendor_id",
      ),
    };
  }
  async applyRazorpayCapturedTransfer(
    draft: SettlementInstructionDraft,
    paymentReference: string,
    now: string,
  ): Promise<{ receiptSha256: string; providerPayoutReference: string }> {
    await this.authorityGuard?.assertCurrent();
    await this.apiCredentialGuard?.assertCurrent();
    if (this.provider !== "RAZORPAY_ROUTE")
      throw new Error("Razorpay transfer unavailable for provider");
    if (!this.config.razorpayTransferPathTemplate?.includes("{payment_id}"))
      throw new Error("Razorpay transfer path unavailable");
    const url = resolveExternalProviderEndpoint(
        this.config.baseUrl,
        this.config.razorpayTransferPathTemplate.replace(
          "{payment_id}",
          encodeURIComponent(paymentReference),
        ),
      ),
      payload = JSON.stringify(razorpayRouteRequest(draft)),
      requestReceipt = await this.store.preserve(
        "settlement/RAZORPAY_ROUTE/transfer-request",
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
          "x-idempotency-key": draft.idempotencyKey,
          ...this.config.additionalHeaders,
        },
        body: payload,
        signal: AbortSignal.timeout(30_000),
      }),
      bytes = await readBoundedResponseBody(response, 2_000_000),
      receipt = await this.store.preserve(
        "settlement/RAZORPAY_ROUTE/transfer-response",
        bytes,
        response.headers.get("content-type") ?? "application/json",
        url.toString(),
        now,
      );
    if (!response.ok)
      throw new Error(
        `Razorpay transfer HTTP ${response.status}; request=${requestReceipt.objectKey}; response=${receipt.objectKey}`,
      );
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as {
        items?: { id?: string; account?: string; amount?: number; currency?: string; on_hold?: boolean }[];
      },
      expected = razorpayRouteRequest(draft) as {
        transfers: { account: string; amount: number; currency: string }[];
      },
      item = decoded.items?.[0];
    if (
      decoded.items?.length !== 1 ||
      item?.account !== expected.transfers[0]!.account ||
      item.amount !== expected.transfers[0]!.amount ||
      item.currency !== "INR" || item.on_hold !== true || !item.id
    )
      throw new Error(
        `Razorpay transfer acknowledgement mismatch; response=${receipt.objectKey}`,
      );
    return { receiptSha256: receipt.sha256, providerPayoutReference: item.id };
  }
  async releaseSupplierPayout(
    providerPayoutReference: string,
    providerInstructionReference: string,
    now: string,
  ): Promise<{ receiptSha256: string }> {
    await this.authorityGuard?.assertCurrent();
    await this.apiCredentialGuard?.assertCurrent();
    let path: string,
      method: "PUT" | "PATCH",
      payload: Readonly<Record<string, unknown>>;
    if (this.provider === "CASHFREE_EASY_SPLIT") {
      if (
        !this.config.cashfreeSettlementEligibilityPathTemplate?.includes("{vendor_id}") ||
        !this.config.cashfreeSettlementEligibilityPathTemplate?.includes("{order_id}")
      )
        throw new Error("Cashfree delayed-settlement release path unavailable");
      path = this.config.cashfreeSettlementEligibilityPathTemplate
        .replace("{order_id}", encodeURIComponent(providerInstructionReference))
        .replace("{vendor_id}", encodeURIComponent(providerPayoutReference));
      method = "PUT";
      payload = { settlementEligibilityDateUpdate: now };
    } else if (this.provider === "RAZORPAY_ROUTE") {
      if (
        !this.config.razorpayTransferReleasePathTemplate?.includes(
          "{transfer_id}",
        )
      )
        throw new Error("Razorpay held-transfer release path unavailable");
      path = this.config.razorpayTransferReleasePathTemplate.replace(
        "{transfer_id}",
        encodeURIComponent(providerPayoutReference),
      );
      method = "PATCH";
      payload = { on_hold: false };
    } else {
      throw new Error("provider supplier-payout release is not API implemented");
    }
    const url = resolveExternalProviderEndpoint(this.config.baseUrl, path),
      body = JSON.stringify(payload),
      response = await this.fetcher(url, {
        method,
        headers: {
          authorization: this.config.authorizationHeader,
          "content-type": "application/json",
          "x-idempotency-key": `supplier-release:${providerPayoutReference}`,
          ...this.config.additionalHeaders,
        },
        body,
        signal: AbortSignal.timeout(30_000),
      }),
      bytes = await readBoundedResponseBody(response, 2_000_000),
      receipt = await this.store.preserve(
        `settlement/${this.provider}/supplier-release`,
        bytes,
        response.headers.get("content-type") ?? "application/json",
        url.toString(),
        now,
      );
    if (!response.ok)
      throw new Error(
        `${this.provider} supplier release HTTP ${response.status}; response=${receipt.objectKey}`,
      );
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
    if (this.provider === "RAZORPAY_ROUTE" && decoded.on_hold !== false)
      throw new Error("Razorpay supplier release acknowledgement mismatch");
    if (
      this.provider === "CASHFREE_EASY_SPLIT" &&
      !["ELIGIBLE", "SUCCESS", "OK"].includes(
        String(decoded.status ?? decoded.settlement_eligibility ?? "").toUpperCase(),
      )
    )
      throw new Error("Cashfree supplier release acknowledgement mismatch");
    return { receiptSha256: receipt.sha256 };
  }
}

export function assertCashfreeSplitVerification(
  decoded: unknown,
  draft: SettlementInstructionDraft,
): void {
  if (!decoded || typeof decoded !== "object")
    throw new Error("Cashfree split verification malformed");
  const result = decoded as {
      settlement?: {
        order_id?: unknown;
        order_currency?: unknown;
        order_amount?: unknown;
        settlement_amount?: unknown;
      };
      vendors?: unknown;
    },
    settlement = result.settlement,
    vendors = Array.isArray(result.vendors) ? result.vendors : [],
    expectedVendor = providerReference(
      draft.providerParties.supplier,
      "vendor_id",
    );
  if (
    !settlement ||
    String(settlement.order_id ?? "") !== draft.instructionId ||
    String(settlement.order_currency ?? "").toUpperCase() !== draft.currency ||
    !sameDecimal(settlement.order_amount, draft.grossAmount) ||
    !sameDecimal(settlement.settlement_amount, draft.sablestoneEntitlement) ||
    vendors.length !== 1
  )
    throw new Error("Cashfree split verification economics mismatch");
  const vendor = vendors[0] as {
    vendor_id?: unknown;
    settlement_amount?: unknown;
  };
  if (
    String(vendor.vendor_id ?? "") !== expectedVendor ||
    !sameDecimal(vendor.settlement_amount, draft.supplierEntitlement)
  )
    throw new Error("Cashfree split verification beneficiary mismatch");
}

function sameDecimal(actual: unknown, expected: string): boolean {
  try {
    return (
      (typeof actual === "string" || typeof actual === "number") &&
      decimal(String(actual)) === decimal(expected)
    );
  } catch {
    return false;
  }
}

function exactProviderDecimal(value: unknown) {
  try {
    return typeof value === "string" || typeof value === "number"
      ? decimal(String(value))
      : null;
  } catch {
    return null;
  }
}
function field(value: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value,
    );
}
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function inrPaise(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error("Razorpay INR amount must have at most two decimals");
  const [whole, fraction = ""] = value.split("."),
    paise = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (paise > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Razorpay amount exceeds safe integer");
  return Number(paise);
}
function providerReference(
  party: Readonly<Record<string, string>>,
  key: string,
): string {
  const value = party[key];
  if (!value?.trim())
    throw new Error(`verified provider party reference missing:${key}`);
  return value;
}

export const escrowComRequest: SettlementRequestBuilder = (draft) => ({
  currency: draft.currency.toLowerCase(),
  description: `SableStone protected polymer trade ${draft.tradeId}`,
  parties: [
    {
      role: "buyer",
      customer: providerReference(draft.providerParties.buyer, "customer"),
    },
    {
      role: "seller",
      customer: providerReference(draft.providerParties.supplier, "customer"),
    },
    {
      role: "broker",
      customer: providerReference(draft.providerParties.sablestone, "customer"),
    },
  ],
  items: [
    {
      type: "general_merchandise",
      category: "other_merchandise",
      title: draft.commodityFamily,
      description: `Protected polymer allocation ${draft.tradeId}`,
      quantity: 1,
      inspection_period: 259200,
      schedule: [
        {
          payer_customer: providerReference(
            draft.providerParties.buyer,
            "customer",
          ),
          beneficiary_customer: providerReference(
            draft.providerParties.supplier,
            "customer",
          ),
          amount: draft.supplierEntitlement,
        },
      ],
    },
    {
      type: "broker_fee",
      title: "SableStone brokerage",
      quantity: 1,
      schedule: [
        {
          payer_customer: providerReference(
            draft.providerParties.buyer,
            "customer",
          ),
          beneficiary_customer: providerReference(
            draft.providerParties.sablestone,
            "customer",
          ),
          amount: draft.sablestoneEntitlement,
        },
      ],
    },
  ],
  privacy: { buyer: true, seller: true, broker_fee: true },
  metadata: {
    instruction_id: draft.instructionId,
    trade_id: draft.tradeId,
    instruction_digest: draft.idempotencyKey,
  },
});
// Split-after-payment: supplier is the only vendor; SableStone retains merchant balance.
export const cashfreeSplitRequest: SettlementRequestBuilder = (draft) => ({
  split: [
    {
      vendor_id: providerReference(draft.providerParties.supplier, "vendor_id"),
      amount: draft.supplierEntitlement,
      tags: { trade_id: draft.tradeId, instruction_id: draft.instructionId },
    },
  ],
  disable_split: true,
});
export const cashfreeOrderRequest: SettlementRequestBuilder = (draft) => ({
  order_id: draft.instructionId,
  order_amount: draft.grossAmount,
  order_currency: draft.currency,
  order_note: `protected trade ${draft.tradeId}`,
  customer_details: {
    customer_id: providerReference(draft.providerParties.buyer, "customer_id"),
    customer_name: providerReference(
      draft.providerParties.buyer,
      "customer_name",
    ),
    customer_email: providerReference(
      draft.providerParties.buyer,
      "customer_email",
    ),
    customer_phone: providerReference(
      draft.providerParties.buyer,
      "customer_phone",
    ),
  },
});
export const razorpayRouteRequest: SettlementRequestBuilder = (draft) => {
  if (draft.currency !== "INR") throw new Error("Razorpay Route requires INR");
  return {
    transfers: [
      {
        account: providerReference(
          draft.providerParties.supplier,
          "linked_account_id",
        ),
        amount: inrPaise(draft.supplierEntitlement),
        currency: "INR",
        on_hold: true,
        notes: { trade_id: draft.tradeId, instruction_id: draft.instructionId },
      },
    ],
  };
};
export const razorpayOrderRequest: SettlementRequestBuilder = (draft) => {
  if (draft.currency !== "INR") throw new Error("Razorpay Route requires INR");
  return {
    amount: inrPaise(draft.grossAmount),
    currency: "INR",
    receipt: draft.instructionId,
    notes: { trade_id: draft.tradeId, instruction_id: draft.instructionId },
  };
};
export const bankEscrowRequest: SettlementRequestBuilder = (draft) => ({
  instruction_id: draft.instructionId,
  gross_amount: draft.grossAmount,
  currency: draft.currency,
  beneficiaries: [
    {
      id: providerReference(draft.providerParties.supplier, "beneficiary_id"),
      amount: draft.supplierEntitlement,
      role: "SELLER",
    },
    {
      id: providerReference(draft.providerParties.sablestone, "beneficiary_id"),
      amount: draft.sablestoneEntitlement,
      role: "BROKER",
    },
  ],
  release_conditions: draft.releaseConditions,
  dispute_procedure: draft.disputeProcedure,
  expires_at: draft.expiresAt,
});
export const lcProceedsRequest: SettlementRequestBuilder = (draft) => ({
  instruction_id: draft.instructionId,
  credit_beneficiary: providerReference(
    draft.providerParties.supplier,
    "credit_beneficiary_id",
  ),
  assignee: providerReference(draft.providerParties.sablestone, "assignee_id"),
  assigned_amount: draft.sablestoneEntitlement,
  currency: draft.currency,
  bank_acknowledgement_required: true,
  trade_id: draft.tradeId,
});
