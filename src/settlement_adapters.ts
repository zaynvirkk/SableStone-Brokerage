import {
  assertAdapterAvailable,
  assertSettlementInstruction,
  evaluateProviderCapability,
  SettlementEventInbox,
  type ProviderApproval,
  type ProviderCapabilitySnapshot,
  type ProviderCredentials,
  type SettlementAdapter,
  type SettlementCapability,
  type SettlementInstructionDraft,
  type SettlementProviderEvent,
} from "./settlement.js";

interface CreatedInstruction {
  readonly state: "CREATED";
  readonly providerReference: string;
  readonly acknowledged: boolean;
}

abstract class ApprovedAdapter implements SettlementAdapter {
  abstract readonly provider: string;
  constructor(
    readonly environment: "SANDBOX" | "PRODUCTION",
    protected readonly approval: ProviderApproval,
    protected readonly credentials: ProviderCredentials,
  ) {
    if (
      environment !== "SANDBOX" ||
      approval.environment !== "SANDBOX" ||
      credentials.environment !== "SANDBOX"
    ) {
      throw new Error(
        "deterministic fixture settlement adapters are sandbox-only",
      );
    }
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
  abstract createInstruction(
    draft: SettlementInstructionDraft,
    now: string,
  ): Promise<Readonly<CreatedInstruction>>;
  protected validate(
    draft: SettlementInstructionDraft,
    required: readonly SettlementCapability[],
    now: string,
  ): void {
    assertAdapterAvailable(this.capability(required, now));
    assertSettlementInstruction(draft, this.approval, now);
  }
}

export interface EscrowBrokerOptions {
  readonly brokerRole: true;
  readonly concealBuyerFromSellerUntilRelease: true;
  readonly concealSellerFromBuyerUntilRelease: true;
  readonly brokerFeeItem: true;
}
export class EscrowComAdapter extends ApprovedAdapter {
  readonly provider = "ESCROW_COM";
  readonly options: EscrowBrokerOptions = Object.freeze({
    brokerRole: true,
    concealBuyerFromSellerUntilRelease: true,
    concealSellerFromBuyerUntilRelease: true,
    brokerFeeItem: true,
  });
  readonly #instructions = new Map<string, Readonly<CreatedInstruction>>();
  async createInstruction(
    draft: SettlementInstructionDraft,
    now: string,
  ): Promise<Readonly<CreatedInstruction>> {
    this.validate(
      draft,
      [
        "BROKER_FEE_SPLIT",
        "CONDITIONAL_RELEASE",
        "REFUND_ALLOCATION",
        "DISPUTE_FREEZE",
      ],
      now,
    );
    const previous = this.#instructions.get(draft.idempotencyKey);
    if (previous) return previous;
    const created = Object.freeze({
      state: "CREATED" as const,
      providerReference: `escrow-fixture:${draft.instructionId}`,
      acknowledged: true,
    });
    this.#instructions.set(draft.idempotencyKey, created);
    return created;
  }
  receiveWebhook(
    inbox: SettlementEventInbox,
    event: SettlementProviderEvent,
  ): Readonly<SettlementProviderEvent> {
    return inbox.insert(event);
  }
}

export interface BankAcknowledgement {
  readonly instructionId: string;
  readonly bankReference: string;
  readonly signedReceiptId: string;
  readonly instructionDigest: string;
  readonly acknowledgedAt: string;
  readonly signatureVerified: boolean;
}
export class IndianBankEscrowAdapter extends ApprovedAdapter {
  readonly provider = "INDIAN_BANK_ESCROW";
  readonly #drafts = new Map<string, SettlementInstructionDraft>();
  async createInstruction(
    draft: SettlementInstructionDraft,
    now: string,
  ): Promise<Readonly<CreatedInstruction>> {
    this.validate(
      draft,
      [
        "BROKER_FEE_SPLIT",
        "CONDITIONAL_RELEASE",
        "DISPUTE_FREEZE",
        "BANK_ACKNOWLEDGEMENT",
      ],
      now,
    );
    this.#drafts.set(draft.instructionId, Object.freeze({ ...draft }));
    return Object.freeze({
      state: "CREATED",
      providerReference: `bank-draft:${draft.instructionId}`,
      acknowledged: false,
    });
  }
  acknowledge(ack: BankAcknowledgement): Readonly<CreatedInstruction> {
    if (!this.#drafts.has(ack.instructionId))
      throw new Error("unknown bank instruction");
    if (
      !ack.signatureVerified ||
      !ack.bankReference.trim() ||
      !ack.signedReceiptId.trim() ||
      !/^[0-9a-f]{64}$/.test(ack.instructionDigest)
    )
      throw new Error("bank acknowledgement invalid");
    return Object.freeze({
      state: "CREATED",
      providerReference: ack.bankReference,
      acknowledged: true,
    });
  }
}

export interface CashfreeVendor {
  readonly vendorId: string;
  readonly organizationId: string;
  readonly kycState: "ACTIVE" | "PENDING" | "REJECTED";
  readonly bankVerified: boolean;
}
export class CashfreeEasySplitAdapter extends ApprovedAdapter {
  readonly provider = "CASHFREE_EASY_SPLIT";
  constructor(
    environment: "SANDBOX" | "PRODUCTION",
    approval: ProviderApproval,
    credentials: ProviderCredentials,
    readonly supplierVendor: CashfreeVendor,
  ) {
    super(environment, approval, credentials);
  }
  async createInstruction(
    draft: SettlementInstructionDraft,
    now: string,
  ): Promise<Readonly<CreatedInstruction>> {
    this.validate(
      draft,
      ["BROKER_FEE_SPLIT", "REFUND_ALLOCATION", "REVERSAL_EVENTS"],
      now,
    );
    if (
      this.supplierVendor.organizationId !== draft.supplierId ||
      this.supplierVendor.kycState !== "ACTIVE" ||
      !this.supplierVendor.bankVerified
    )
      throw new Error("Cashfree vendor not active and verified");
    return Object.freeze({
      state: "CREATED",
      providerReference: `cashfree-fixture:${draft.instructionId}`,
      acknowledged: true,
    });
  }
  receiveSettlementWebhook(
    inbox: SettlementEventInbox,
    event: SettlementProviderEvent,
  ): Readonly<SettlementProviderEvent> {
    const allowed = [
      "VENDOR_SETTLEMENT_SUCCESS",
      "VENDOR_SETTLEMENT_FAILED",
      "VENDOR_SETTLEMENT_REVERSED",
      "REFUND_ADJUSTED",
    ];
    if (!allowed.includes(event.eventType))
      throw new Error("unsupported Cashfree event");
    return inbox.insert(event);
  }
}

export type RazorpayEligibility = "ELIGIBLE" | "INELIGIBLE" | "UNDER_REVIEW";
export class RazorpayRouteAdapter extends ApprovedAdapter {
  readonly provider = "RAZORPAY_ROUTE";
  constructor(
    environment: "SANDBOX" | "PRODUCTION",
    approval: ProviderApproval,
    credentials: ProviderCredentials,
    readonly eligibility: RazorpayEligibility,
    readonly eligibilityReceiptId: string | null,
  ) {
    super(environment, approval, credentials);
  }
  async createInstruction(
    draft: SettlementInstructionDraft,
    now: string,
  ): Promise<Readonly<CreatedInstruction>> {
    if (this.eligibility !== "ELIGIBLE" || !this.eligibilityReceiptId)
      throw new Error(`Razorpay Route ${this.eligibility.toLowerCase()}`);
    this.validate(draft, ["BROKER_FEE_SPLIT", "REVERSAL_EVENTS"], now);
    return Object.freeze({
      state: "CREATED",
      providerReference: `razorpay-fixture:${draft.instructionId}`,
      acknowledged: true,
    });
  }
}

export interface LcProceedsAcknowledgement {
  readonly instructionId: string;
  readonly issuingOrNominatedBank: string;
  readonly acknowledgementReceiptId: string;
  readonly applicableLawReviewReceiptId: string;
  readonly assignmentDigest: string;
  readonly signatureVerified: boolean;
}
export class LcProceedsAdapter extends ApprovedAdapter {
  readonly provider = "LC_PROCEEDS";
  readonly #drafts = new Map<string, SettlementInstructionDraft>();
  async createInstruction(
    draft: SettlementInstructionDraft,
    now: string,
  ): Promise<Readonly<CreatedInstruction>> {
    this.validate(draft, ["BROKER_FEE_SPLIT", "BANK_ACKNOWLEDGEMENT"], now);
    this.#drafts.set(draft.instructionId, Object.freeze({ ...draft }));
    return Object.freeze({
      state: "CREATED",
      providerReference: `lc-assignment-draft:${draft.instructionId}`,
      acknowledged: false,
    });
  }
  acknowledge(ack: LcProceedsAcknowledgement): Readonly<CreatedInstruction> {
    if (!this.#drafts.has(ack.instructionId))
      throw new Error("unknown LC proceeds instruction");
    if (
      !ack.signatureVerified ||
      !ack.issuingOrNominatedBank.trim() ||
      !ack.acknowledgementReceiptId.trim() ||
      !ack.applicableLawReviewReceiptId.trim() ||
      !/^[0-9a-f]{64}$/.test(ack.assignmentDigest)
    )
      throw new Error("bank-acknowledged LC proceeds instruction required");
    return Object.freeze({
      state: "CREATED",
      providerReference: `lc-bank:${ack.acknowledgementReceiptId}`,
      acknowledged: true,
    });
  }
}
