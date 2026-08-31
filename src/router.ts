import { compareDecimalStrings } from "./domain.js";
import { addDecimal, decimal } from "./money.js";
import { assertAdapterAvailable, requiredSettlementCapabilities, type ProviderCapabilitySnapshot, type SettlementAdapter, type SettlementCapability, type SettlementInstructionDraft } from "./settlement.js";
import { ProtectedIdentityVault, type IdentityReleaseAuthorization, type IdentityReleaseEvent, type ProtectedRelationship } from "./vault.js";

export interface SettlementRouteContext {
  readonly geography: "DOMESTIC_INDIA" | "INTERNATIONAL";
  readonly relationshipMaturity: "NEW" | "ESTABLISHED";
  readonly hasDocumentaryLc: boolean;
}
export interface RoutedSettlement {
  readonly adapter: SettlementAdapter;
  readonly snapshot: ProviderCapabilitySnapshot;
}
export function routeSettlement(context: SettlementRouteContext, adapters: readonly SettlementAdapter[], required: readonly SettlementCapability[], now: string): RoutedSettlement {
  const preference = context.geography === "DOMESTIC_INDIA"
    ? ["CASHFREE_EASY_SPLIT", "INDIAN_BANK_ESCROW", "RAZORPAY_ROUTE"]
    : context.relationshipMaturity === "ESTABLISHED" && context.hasDocumentaryLc
      ? ["LC_PROCEEDS", "ESCROW_COM"] : ["ESCROW_COM"];
  for (const provider of preference) {
    const adapter = adapters.find((candidate) => candidate.provider === provider);
    if (!adapter) continue;
    const snapshot = adapter.capability([...new Set([...required, ...requiredSettlementCapabilities(adapter.provider)])], now);
    if (snapshot.state === "AVAILABLE") return Object.freeze({ adapter, snapshot });
  }
  throw new Error("NO_ELIGIBLE_SETTLEMENT_RAIL");
}

export interface FeeLockInput {
  readonly feeLockId: string;
  readonly tradeId: string;
  readonly relationshipId: string;
  readonly instruction: SettlementInstructionDraft;
  readonly providerSnapshot: ProviderCapabilitySnapshot;
  readonly providerReference: string;
  readonly providerAcknowledged: boolean;
  readonly instructionDigest: string;
  readonly supplierAcceptedInstructionDigest: string;
  readonly buyerAcceptedInstructionDigest: string;
  readonly createdAt: string;
}
export interface FeeLock {
  readonly feeLockId: string;
  readonly tradeId: string;
  readonly relationshipId: string;
  readonly instructionId: string;
  readonly provider: string;
  readonly providerApprovalId: string;
  readonly providerReference: string;
  readonly instructionDigest: string;
  readonly supplierEntitlement: string;
  readonly sablestoneEntitlement: string;
  readonly grossAmount: string;
  readonly currency: string;
  readonly createdAt: string;
  readonly state: "LOCKED";
}
export class FeeLockRegistry {
  readonly #locks = new Map<string, Readonly<FeeLock>>();
  lock(input: FeeLockInput): Readonly<FeeLock> {
    const previous = this.#locks.get(input.feeLockId);
    if (previous) {
      if (previous.instructionDigest !== input.instructionDigest || previous.providerReference !== input.providerReference) throw new Error("fee lock replay conflict");
      return previous;
    }
    assertAdapterAvailable(input.providerSnapshot);
    if (!input.providerSnapshot.approvalId || input.providerSnapshot.provider !== input.instruction.provider) throw new Error("provider approval mismatch");
    if (!input.providerAcknowledged || !input.providerReference.trim()) throw new Error("provider acknowledgement required for fee lock");
    if (!/^[0-9a-f]{64}$/.test(input.instructionDigest)) throw new Error("instruction digest invalid");
    if (input.supplierAcceptedInstructionDigest !== input.instructionDigest || input.buyerAcceptedInstructionDigest !== input.instructionDigest) throw new Error("both parties must accept exact settlement economics");
    let allocated = addDecimal(input.instruction.supplierEntitlement, input.instruction.sablestoneEntitlement);
    for (const other of input.instruction.otherAllocations) allocated = addDecimal(allocated, other.amount);
    if (compareDecimalStrings(allocated, input.instruction.grossAmount) !== 0 || compareDecimalStrings(input.instruction.sablestoneEntitlement, decimal("0")) <= 0) throw new Error("fee allocation invariant failed");
    const lock = Object.freeze({ feeLockId: input.feeLockId, tradeId: input.tradeId, relationshipId: input.relationshipId, instructionId: input.instruction.instructionId, provider: input.instruction.provider, providerApprovalId: input.providerSnapshot.approvalId, providerReference: input.providerReference, instructionDigest: input.instructionDigest, supplierEntitlement: input.instruction.supplierEntitlement, sablestoneEntitlement: input.instruction.sablestoneEntitlement, grossAmount: input.instruction.grossAmount, currency: input.instruction.currency, createdAt: input.createdAt, state: "LOCKED" as const });
    this.#locks.set(input.feeLockId, lock); return lock;
  }
}

export function releaseIdentityAfterFeeLock(vault: ProtectedIdentityVault, relationship: ProtectedRelationship, lock: FeeLock, authorization: Omit<IdentityReleaseAuthorization, "relationshipId" | "commissionLocked" | "settlementAvailable" | "feeLockId">): Readonly<IdentityReleaseEvent> {
  if (lock.relationshipId !== relationship.relationshipId || lock.state !== "LOCKED") throw new Error("fee lock does not bind protected relationship");
  return vault.release(relationship, { ...authorization, relationshipId: relationship.relationshipId, commissionLocked: true, settlementAvailable: true, feeLockId: lock.feeLockId });
}
