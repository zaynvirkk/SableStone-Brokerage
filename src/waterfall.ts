import { createHash } from "node:crypto";
import { compareDecimalStrings } from "./domain.js";
import {
  addDecimal,
  decimal,
  subtractDecimal,
  type DecimalString,
} from "./money.js";

export type SettlementTreatment =
  | "SUPPLIER_ENTITLEMENT"
  | "THIRD_PARTY_ALLOCATION"
  | "BUYER_DIRECT"
  | "SUPPLIER_DIRECT"
  | "PROVIDER_DEDUCTED"
  | "WITHHELD_RESERVE";
export type CostPayerRole = "BUYER" | "SUPPLIER" | "SABLESTONE";
export interface WaterfallCost {
  readonly kind: string;
  readonly amountPerKg: DecimalString;
  readonly payerRole: CostPayerRole;
  readonly settlementTreatment: SettlementTreatment;
  readonly beneficiaryRole: string | null;
  readonly beneficiaryId: string | null;
  readonly sourceReceiptId: string;
}
export interface WaterfallAllocation {
  readonly costKind: string;
  readonly amountPerKg: DecimalString;
  readonly beneficiaryId: string | null;
  readonly purpose: string;
}
export interface FinalWaterfall {
  readonly supplierEntitlementPerKg: DecimalString;
  readonly sablestoneEntitlementPerKg: DecimalString;
  readonly settlementGrossPerKg: DecimalString;
  readonly buyerDirectPerKg: DecimalString;
  readonly buyerAllInPerKg: DecimalString;
  readonly thirdPartyAllocations: readonly WaterfallAllocation[];
  readonly providerDeductions: readonly WaterfallAllocation[];
  readonly reserveAllocations: readonly WaterfallAllocation[];
  readonly buyerDirectCosts: readonly WaterfallAllocation[];
  readonly digest: string;
}

export function buildFinalWaterfall(
  costs: readonly WaterfallCost[],
  acceptedBuyerPricePerKg: DecimalString,
  realizedCommissionPerKg: DecimalString,
): FinalWaterfall {
  if (!costs.length) throw new Error("waterfall costs missing");
  let supplier = decimal("0"),
    buyerDirect = decimal("0"),
    settlementCosts = decimal("0");
  const third: WaterfallAllocation[] = [],
    deductions: WaterfallAllocation[] = [],
    reserves: WaterfallAllocation[] = [],
    direct: WaterfallAllocation[] = [];
  for (const cost of costs) {
    if (cost.amountPerKg.startsWith("-")) throw new Error("negative waterfall cost");
    const allocation = Object.freeze({
      costKind: cost.kind,
      amountPerKg: cost.amountPerKg,
      beneficiaryId: cost.beneficiaryId,
      purpose: cost.settlementTreatment,
    });
    switch (cost.settlementTreatment) {
      case "SUPPLIER_ENTITLEMENT":
        if (cost.beneficiaryRole !== "SUPPLIER")
          throw new Error("supplier entitlement beneficiary invalid");
        supplier = addDecimal(supplier, cost.amountPerKg);
        settlementCosts = addDecimal(settlementCosts, cost.amountPerKg);
        break;
      case "SUPPLIER_DIRECT":
        if (cost.payerRole !== "SUPPLIER")
          throw new Error("supplier-direct payer invalid");
        supplier = addDecimal(supplier, cost.amountPerKg);
        settlementCosts = addDecimal(settlementCosts, cost.amountPerKg);
        break;
      case "BUYER_DIRECT":
        if (cost.payerRole !== "BUYER" || cost.beneficiaryId)
          throw new Error("buyer-direct classification invalid");
        buyerDirect = addDecimal(buyerDirect, cost.amountPerKg);
        direct.push(allocation);
        break;
      case "THIRD_PARTY_ALLOCATION":
        if (!cost.beneficiaryId || cost.beneficiaryRole !== "THIRD_PARTY")
          throw new Error("third-party beneficiary missing");
        settlementCosts = addDecimal(settlementCosts, cost.amountPerKg);
        third.push(allocation);
        break;
      case "PROVIDER_DEDUCTED":
        if (cost.beneficiaryRole !== "PROVIDER")
          throw new Error("provider deduction beneficiary invalid");
        settlementCosts = addDecimal(settlementCosts, cost.amountPerKg);
        deductions.push(allocation);
        break;
      case "WITHHELD_RESERVE":
        if (!cost.beneficiaryId || cost.beneficiaryRole !== "RESERVE")
          throw new Error("reserve custodian missing");
        settlementCosts = addDecimal(settlementCosts, cost.amountPerKg);
        reserves.push(allocation);
        break;
    }
  }
  const settlementGross = subtractDecimal(acceptedBuyerPricePerKg, buyerDirect),
    expectedGross = addDecimal(
      settlementCosts,
      realizedCommissionPerKg,
    );
  if (compareDecimalStrings(settlementGross, expectedGross) !== 0)
    throw new Error("waterfall settlement allocation mismatch");
  const canonical = {
    supplierEntitlementPerKg: supplier,
    sablestoneEntitlementPerKg: realizedCommissionPerKg,
    settlementGrossPerKg: settlementGross,
    buyerDirectPerKg: buyerDirect,
    buyerAllInPerKg: acceptedBuyerPricePerKg,
    thirdPartyAllocations: third,
    providerDeductions: deductions,
    reserveAllocations: reserves,
    buyerDirectCosts: direct,
  };
  return Object.freeze({
    ...canonical,
    thirdPartyAllocations: Object.freeze(third),
    providerDeductions: Object.freeze(deductions),
    reserveAllocations: Object.freeze(reserves),
    buyerDirectCosts: Object.freeze(direct),
    digest: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  });
}
