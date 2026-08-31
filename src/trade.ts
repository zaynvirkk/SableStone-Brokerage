import { assertTradeTransition, type TradeState, type TradeTransitionEvidence } from "./lifecycle.js";

export interface MaterialContract {
  readonly contractId: string;
  readonly tradeId: string;
  readonly sellerOrganizationId: string;
  readonly buyerOrganizationId: string;
  readonly brokerOrganizationId: string;
  readonly materialInvoiceIssuerId: string;
  readonly qualityObligationOwnerId: string;
  readonly titleHolderUntilTransferId: string;
  readonly agreementDigest: string;
  readonly acceptedAt: string;
}
export interface FundingEvent { readonly provider: string; readonly providerReference: string; readonly purchaseFundsCustodian: string; readonly fundedAt: string; readonly signatureVerified: boolean; }
export interface ShipmentEvent { readonly eventId: string; readonly carrierOrganizationId: string; readonly responsiblePartyId: string; readonly eventType: "DISPATCHED" | "IN_TRANSIT" | "DELIVERED"; readonly documentReceiptId: string; readonly occurredAt: string; }
export interface InspectionEvent { readonly inspectionProviderId: string; readonly engagedByOrganizationId: string; readonly paidByOrganizationId: string; readonly certificateReceiptId: string; readonly verdict: "PASS" | "FAIL" | "WAIVED_BY_BUYER"; readonly occurredAt: string; }
export interface DisputeEvent { readonly disputeId: string; readonly externalProcedureOwner: string; readonly fundsFrozenByProvider: boolean; readonly reason: string; readonly openedAt: string; }

export class TradeWorkflow {
  #state: TradeState;
  readonly #events: readonly object[] = [];
  constructor(readonly tradeId: string, readonly supplierId: string, readonly buyerId: string, readonly sablestoneId: string, initialState: TradeState = "IDENTITY_RELEASED") { this.#state = initialState; }
  state(): TradeState { return this.#state; }
  private move(to: TradeState, evidence: TradeTransitionEvidence): void { assertTradeTransition(this.#state, to, evidence); this.#state = to; }
  contract(contract: MaterialContract, evidence: TradeTransitionEvidence): void {
    if (contract.tradeId !== this.tradeId || contract.sellerOrganizationId !== this.supplierId || contract.materialInvoiceIssuerId !== this.supplierId || contract.qualityObligationOwnerId !== this.supplierId || contract.titleHolderUntilTransferId !== this.supplierId) throw new Error("supplier must remain seller invoice issuer quality owner and title holder");
    if (contract.buyerOrganizationId !== this.buyerId || contract.brokerOrganizationId !== this.sablestoneId || !/^[0-9a-f]{64}$/.test(contract.agreementDigest)) throw new Error("material contract parties or digest invalid");
    this.move("CONTRACTED", evidence);
  }
  fund(event: FundingEvent, evidence: TradeTransitionEvidence): void {
    if (!event.signatureVerified || !event.providerReference.trim() || event.purchaseFundsCustodian === this.sablestoneId) throw new Error("independent signed funding custody required"); this.move("FUNDED", evidence);
  }
  shipment(event: ShipmentEvent, evidence: TradeTransitionEvidence): void {
    if (event.carrierOrganizationId === this.sablestoneId || event.responsiblePartyId === this.sablestoneId || !event.documentReceiptId.trim()) throw new Error("shipment must remain counterparty/carrier owned"); this.move(event.eventType, evidence);
  }
  inspect(event: InspectionEvent): void {
    if ([event.inspectionProviderId, event.engagedByOrganizationId, event.paidByOrganizationId].includes(this.sablestoneId)) throw new Error("inspection cannot be performed engaged or funded by SableStone");
    if (!event.certificateReceiptId.trim()) throw new Error("inspection certificate required");
  }
  accept(evidence: TradeTransitionEvidence): void { this.move("ACCEPTED", evidence); }
  settle(evidence: TradeTransitionEvidence): void { this.move("SETTLED", evidence); }
  dispute(event: DisputeEvent, evidence: TradeTransitionEvidence): void {
    if (!event.externalProcedureOwner.trim() || event.externalProcedureOwner === this.sablestoneId || !event.fundsFrozenByProvider) throw new Error("serious dispute must use external frozen-funds procedure"); this.move("DISPUTED_FROZEN", evidence);
  }
}
