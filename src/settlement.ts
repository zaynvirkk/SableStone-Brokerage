import type { CapabilityState } from "./config.js";
import type { DecimalString } from "./money.js";
import { compareDecimalStrings } from "./domain.js";
import { addDecimal, decimal } from "./money.js";

export type SettlementCapability =
  | "BROKER_FEE_SPLIT"
  | "CONDITIONAL_RELEASE"
  | "DELIVERY_CONDITIONAL_SUPPLIER_RELEASE"
  | "REFUND_ALLOCATION"
  | "DISPUTE_FREEZE"
  | "PROVIDER_DISPUTE_PROCESS"
  | "REVERSAL_EVENTS"
  | "BANK_ACKNOWLEDGEMENT"
  | "MULTI_BENEFICIARY"
  | "PROVIDER_DEDUCTION"
  | "RESERVE_HOLD";
export function requiredSettlementCapabilities(
  provider: string,
): readonly SettlementCapability[] {
  switch (provider) {
    case "ESCROW_COM":
      return Object.freeze([
        "BROKER_FEE_SPLIT",
        "CONDITIONAL_RELEASE",
        "DELIVERY_CONDITIONAL_SUPPLIER_RELEASE",
        "REFUND_ALLOCATION",
        "DISPUTE_FREEZE",
        "PROVIDER_DISPUTE_PROCESS",
      ]);
    case "INDIAN_BANK_ESCROW":
      return Object.freeze([
        "BROKER_FEE_SPLIT",
        "CONDITIONAL_RELEASE",
        "DELIVERY_CONDITIONAL_SUPPLIER_RELEASE",
        "DISPUTE_FREEZE",
        "PROVIDER_DISPUTE_PROCESS",
        "BANK_ACKNOWLEDGEMENT",
      ]);
    case "CASHFREE":
      return Object.freeze(["BROKER_FEE_SPLIT", "CONDITIONAL_RELEASE", "DELIVERY_CONDITIONAL_SUPPLIER_RELEASE","PROVIDER_DISPUTE_PROCESS"]);
    case "CASHFREE_EASY_SPLIT":
      return Object.freeze([
        "BROKER_FEE_SPLIT",
        "DELIVERY_CONDITIONAL_SUPPLIER_RELEASE",
        "REFUND_ALLOCATION",
        "REVERSAL_EVENTS",
        "PROVIDER_DISPUTE_PROCESS",
      ]);
    case "RAZORPAY_ROUTE":
      return Object.freeze(["BROKER_FEE_SPLIT", "REVERSAL_EVENTS", "DELIVERY_CONDITIONAL_SUPPLIER_RELEASE","PROVIDER_DISPUTE_PROCESS"]);
    case "LC_PROCEEDS":
      return Object.freeze(["BROKER_FEE_SPLIT", "BANK_ACKNOWLEDGEMENT", "DELIVERY_CONDITIONAL_SUPPLIER_RELEASE","PROVIDER_DISPUTE_PROCESS"]);
    default:
      throw new Error(`unknown settlement provider ${provider}`);
  }
}
export type SettlementEnvironment = "SANDBOX" | "PRODUCTION";
export interface ProviderApproval {
  readonly approvalId: string;
  readonly provider: string;
  readonly environment: SettlementEnvironment;
  readonly writtenApprovalReceiptId: string;
  readonly actualUseCase: string;
  readonly commodityFamilies: readonly string[];
  readonly currencies: readonly string[];
  readonly minimumGross: DecimalString;
  readonly maximumGross: DecimalString;
  readonly capabilities: readonly SettlementCapability[];
  readonly validFrom: string;
  readonly validUntil: string;
  readonly state: "APPROVED" | "UNDER_REVIEW" | "REVOKED";
}
export interface ProviderCredentials {
  readonly provider: string;
  readonly environment: SettlementEnvironment;
  readonly state: "VALID" | "MISSING" | "EXPIRED" | "REVOKED";
  readonly secretReference: string | null;
  readonly verifiedAt: string | null;
}
export interface ProviderCapabilitySnapshot {
  readonly provider: string;
  readonly environment: SettlementEnvironment;
  readonly state: CapabilityState;
  readonly capabilities: readonly SettlementCapability[];
  readonly approvalId: string | null;
  readonly reason: string;
}
export interface SettlementInstructionDraft {
  readonly instructionId: string;
  readonly tradeId: string;
  readonly provider: string;
  readonly environment: SettlementEnvironment;
  readonly commodityFamily: string;
  readonly buyerId: string;
  readonly supplierId: string;
  readonly sablestoneBeneficiaryId: string;
  readonly providerParties: Readonly<{
    buyer: Readonly<Record<string, string>>;
    supplier: Readonly<Record<string, string>>;
    sablestone: Readonly<Record<string, string>>;
  }>;
  readonly currency: string;
  readonly grossAmount: DecimalString;
  readonly buyerAllInAmount?: DecimalString;
  readonly buyerDirectCosts?: readonly Readonly<{
    costKind: string;
    amount: DecimalString;
    purpose: string;
  }>[];
  readonly providerDeductions?: readonly Readonly<{
    costKind: string;
    amount: DecimalString;
    purpose: string;
  }>[];
  readonly supplierEntitlement: DecimalString;
  readonly sablestoneEntitlement: DecimalString;
  readonly otherAllocations: readonly Readonly<{
    beneficiaryId: string;
    amount: DecimalString;
    purpose: string;
  }>[];
  readonly releaseConditions: readonly string[];
  readonly disputeProcedure: string;
  readonly expiresAt: string;
  readonly idempotencyKey: string;
}

export function assertSettlementInstruction(
  draft: SettlementInstructionDraft,
  approval: ProviderApproval,
  now: string,
): void {
  if (
    draft.provider !== approval.provider ||
    draft.environment !== approval.environment
  )
    throw new Error("instruction provider scope mismatch");
  if (
    !approval.commodityFamilies.includes(draft.commodityFamily) ||
    !approval.currencies.includes(draft.currency)
  )
    throw new Error("commodity or currency not approved");
  if (Date.parse(draft.expiresAt) <= Date.parse(now))
    throw new Error("settlement instruction expired");
  if (
    !draft.idempotencyKey.trim() ||
    !draft.buyerId.trim() ||
    !draft.supplierId.trim() ||
    !draft.sablestoneBeneficiaryId.trim()
  )
    throw new Error("settlement parties and idempotency required");
  if (
    draft.buyerId === draft.supplierId ||
    draft.supplierId === draft.sablestoneBeneficiaryId ||
    draft.buyerId === draft.sablestoneBeneficiaryId
  )
    throw new Error("settlement parties must be distinct");
  if (!draft.releaseConditions.length || !draft.disputeProcedure.trim())
    throw new Error("release and dispute procedure required");
  let allocated = addDecimal(
    draft.supplierEntitlement,
    draft.sablestoneEntitlement,
  );
  for (const allocation of draft.otherAllocations) {
    if (
      !allocation.beneficiaryId.trim() ||
      !allocation.purpose.trim() ||
      allocation.amount.startsWith("-")
    )
      throw new Error("invalid other allocation");
    allocated = addDecimal(allocated, allocation.amount);
  }
  if (compareDecimalStrings(allocated, draft.grossAmount) !== 0)
    throw new Error("gross allocation invariant failed");
  let buyerAllIn = draft.grossAmount;
  for (const cost of draft.buyerDirectCosts ?? [])
    buyerAllIn = addDecimal(buyerAllIn, cost.amount);
  if (
    compareDecimalStrings(
      buyerAllIn,
      draft.buyerAllInAmount ?? draft.grossAmount,
    ) !== 0
  )
    throw new Error("buyer all-in invariant failed");
  if (draft.providerDeductions?.length)
    throw new Error("provider deduction verification unsupported by this rail");
  if (
    [
      draft.grossAmount,
      draft.supplierEntitlement,
      draft.sablestoneEntitlement,
    ].some((value) => value.startsWith("-"))
  )
    throw new Error("negative settlement amount");
  if (
    compareDecimalStrings(draft.grossAmount, approval.minimumGross) < 0 ||
    compareDecimalStrings(draft.grossAmount, approval.maximumGross) > 0
  )
    throw new Error("settlement amount outside approval");
  if (compareDecimalStrings(draft.sablestoneEntitlement, decimal("0")) <= 0)
    throw new Error("positive brokerage entitlement required");
}

export interface SettlementProviderEvent {
  readonly provider: string;
  readonly externalEventId: string;
  readonly providerReference: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly payloadDigest: string;
  readonly signatureVerified: boolean;
}
export class SettlementEventInbox {
  readonly #events = new Map<string, Readonly<SettlementProviderEvent>>();
  insert(event: SettlementProviderEvent): Readonly<SettlementProviderEvent> {
    if (!event.signatureVerified)
      throw new Error("settlement webhook signature invalid");
    if (!/^[0-9a-f]{64}$/.test(event.payloadDigest))
      throw new Error("settlement webhook digest invalid");
    const key = `${event.provider}:${event.externalEventId}`;
    const existing = this.#events.get(key);
    if (existing) {
      if (existing.payloadDigest !== event.payloadDigest)
        throw new Error("settlement webhook replay conflict");
      return existing;
    }
    const stored = Object.freeze({ ...event });
    this.#events.set(key, stored);
    return stored;
  }
  count(): number {
    return this.#events.size;
  }
}

export function evaluateProviderCapability(
  approval: ProviderApproval | null,
  credentials: ProviderCredentials,
  required: readonly SettlementCapability[],
  now: string,
): ProviderCapabilitySnapshot {
  if (!approval)
    return snapshot(
      credentials.provider,
      credentials.environment,
      "UNAVAILABLE",
      [],
      null,
      "written use-case approval missing",
    );
  if (
    approval.provider !== credentials.provider ||
    approval.environment !== credentials.environment
  )
    return snapshot(
      credentials.provider,
      credentials.environment,
      "REVOKED",
      [],
      null,
      "approval scope mismatch",
    );
  if (approval.state === "UNDER_REVIEW")
    return snapshot(
      credentials.provider,
      credentials.environment,
      "UNDER_REVIEW",
      [],
      approval.approvalId,
      "provider underwriting under review",
    );
  if (approval.state === "REVOKED")
    return snapshot(
      credentials.provider,
      credentials.environment,
      "REVOKED",
      [],
      approval.approvalId,
      "provider approval revoked",
    );
  if (
    Date.parse(now) < Date.parse(approval.validFrom) ||
    Date.parse(now) >= Date.parse(approval.validUntil)
  )
    return snapshot(
      credentials.provider,
      credentials.environment,
      "REVOKED",
      [],
      approval.approvalId,
      "provider approval not current",
    );
  if (
    !approval.writtenApprovalReceiptId.trim() ||
    !approval.actualUseCase.trim()
  )
    return snapshot(
      credentials.provider,
      credentials.environment,
      "UNAVAILABLE",
      [],
      approval.approvalId,
      "approval evidence incomplete",
    );
  if (
    credentials.state !== "VALID" ||
    !credentials.secretReference ||
    !credentials.verifiedAt
  )
    return snapshot(
      credentials.provider,
      credentials.environment,
      "UNAVAILABLE",
      [],
      approval.approvalId,
      "valid scoped credentials missing",
    );
  const missing = required.filter(
    (capability) => !approval.capabilities.includes(capability),
  );
  if (missing.length)
    return snapshot(
      credentials.provider,
      credentials.environment,
      "UNAVAILABLE",
      approval.capabilities,
      approval.approvalId,
      `capabilities missing: ${missing.join(",")}`,
    );
  return snapshot(
    credentials.provider,
    credentials.environment,
    "AVAILABLE",
    approval.capabilities,
    approval.approvalId,
    "current written approval and credentials",
  );
}
function snapshot(
  provider: string,
  environment: SettlementEnvironment,
  state: CapabilityState,
  capabilities: readonly SettlementCapability[],
  approvalId: string | null,
  reason: string,
): ProviderCapabilitySnapshot {
  return Object.freeze({
    provider,
    environment,
    state,
    capabilities: Object.freeze([...capabilities]),
    approvalId,
    reason,
  });
}

export interface SettlementAdapter {
  readonly provider: string;
  readonly environment: SettlementEnvironment;
  capability(
    required: readonly SettlementCapability[],
    now: string,
  ): ProviderCapabilitySnapshot;
  createInstruction(
    draft: SettlementInstructionDraft,
    now: string,
  ): Promise<
    Readonly<{
      state: "CREATED";
      providerReference: string;
      acknowledged: boolean;
      fundingToken?: string;
    }>
  >;
  openDispute?(input: Readonly<{providerReference:string;disputeId:string;reason:string;evidenceReceiptId:string|null}>,now:string):Promise<Readonly<{receiptSha256:string;providerDisputeReference:string}>>;
}

export function assertAdapterAvailable(
  snapshotValue: ProviderCapabilitySnapshot,
): void {
  if (snapshotValue.state !== "AVAILABLE")
    throw new Error(`settlement adapter ${snapshotValue.state.toLowerCase()}`);
}
