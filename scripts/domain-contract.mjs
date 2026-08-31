import {
  PRODUCT_FAMILIES,
  assertDemand,
  assertOffer,
  decimal,
  known,
  numericRange,
  quantity,
  unknown,
} from "../dist/index.js";

if (PRODUCT_FAMILIES.length !== 8) throw new Error("product family inventory drift");
const product = {
  family: PRODUCT_FAMILIES[0], polymer: "PP", materialClass: "RECYCLED",
  recycledSource: known("PCR", "doc-source"), grade: known("injection", "doc-tds"),
  application: known("rigid packaging", "doc-tds"),
  properties: [numericRange("MFI", "11", "14", "g/10min")],
};
const offer = {
  offerId: "offer-1", supplierId: "supplier-1", sourceEventId: "event-1", version: 1,
  supersedesOfferId: null, product, available: quantity("80", "MT"),
  monthlyCapacity: unknown(), moq: quantity("20", "MT"), supplierNetPrice: decimal("78.00"),
  currency: "INR", priceBasis: "EXW", incoterm: "EXW", dispatchLocation: "Ahmedabad",
  leadTimeDays: 5, documentIds: ["doc-source"], expiresAt: "2030-01-01T00:00:00Z",
  verificationState: "VERIFIED", freshnessState: "CURRENT",
};
assertOffer(offer);
assertDemand({
  demandId: "demand-1", buyerId: "buyer-1", sourceEventId: "event-2", version: 1,
  product, quantity: quantity("40", "MT"), destination: "Pune",
  buyerCeiling: known({ value: decimal("84"), currency: "INR" }, "demand-source"),
  requiredDocumentKinds: ["COA"], requiredAt: "2029-12-01T00:00:00Z",
  expiresAt: "2029-12-31T00:00:00Z", cadence: unknown(), standing: false,
  verificationState: "VERIFIED", freshnessState: "CURRENT",
});

let rejected = 0;
for (const action of [
  () => quantity("-1", "MT"),
  () => numericRange("MFI", "14", "11", "g/10min"),
  () => known("PCR", ""),
  () => assertOffer({ ...offer, documentIds: [] }),
  () => assertOffer({ ...offer, currency: "₹" }),
]) {
  try { action(); } catch { rejected += 1; }
}
if (rejected !== 5) throw new Error(`domain fail-closed cases lost: ${rejected}/5`);
console.log("DOMAIN_OK families=8 negatives=5 unknown=explicit immutable=versions");
