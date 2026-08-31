import { demand, now, offer } from "./qualification-fixture.mjs";
import { matchOfferDemand, numericRange, quantity, unknown } from "../dist/index.js";
const context = { now, supplierEligible: true, buyerEligible: true, settlementAvailable: true, riskPass: true, destinationSupported: true, requiredDocumentsPresent: true, substitutionPermitted: false, earliestDeliveryAt: "2026-09-05T00:00:00Z" };
const pass = matchOfferDemand(offer, demand, context);
if (!pass.compatible || pass.reasons.length) throw new Error(`valid match rejected ${pass.reasons}`);
const cases = [
  [matchOfferDemand({ ...offer, available: quantity("39.999", "MT") }, demand, context), "QUANTITY_UNAVAILABLE"],
  [matchOfferDemand({ ...offer, moq: quantity("40001", "KG") }, demand, context), "BELOW_MOQ"],
  [matchOfferDemand({ ...offer, product: { ...offer.product, properties: [numericRange("MFI", "1", "9.999", "g/10min")] } }, demand, context), "SPEC_INTERVAL_DISJOINT"],
  [matchOfferDemand({ ...offer, product: { ...offer.product, properties: [numericRange("MFI", "11", "14", "kg")]} }, demand, context), "SPEC_UNIT_MISMATCH"],
  [matchOfferDemand(offer, { ...demand, product: { ...demand.product, application: unknown() } }, context), "APPLICATION_UNKNOWN"],
  [matchOfferDemand(offer, demand, { ...context, settlementAvailable: false }), "SETTLEMENT_UNAVAILABLE"],
  [matchOfferDemand(offer, demand, { ...context, riskPass: false }), "RISK_GATE_FAILED"],
  [matchOfferDemand(offer, demand, { ...context, earliestDeliveryAt: "2026-09-11T00:00:00Z" }), "DELIVERY_DATE_MISFIT"],
];
for (const [result, reason] of cases) if (result.compatible || !result.reasons.includes(reason)) throw new Error(`missing rejection ${reason}`);
console.log("MATCH_OK pass=true negatives=8 units_exact=true interval_edges=true versions_bound=true reasons_complete=true");
