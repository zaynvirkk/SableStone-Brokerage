import { buildFinalWaterfall, decimal } from "../dist/index.js";

const cost=(kind,amount,settlementTreatment,payerRole="BUYER",beneficiaryRole=null,beneficiaryId=null)=>({kind,amountPerKg:decimal(amount),settlementTreatment,payerRole,beneficiaryRole,beneficiaryId,sourceReceiptId:`receipt-${kind}`});
const exw=buildFinalWaterfall([
  cost("SUPPLIER_NET","78","SUPPLIER_ENTITLEMENT","BUYER","SUPPLIER"),
  cost("FREIGHT","2","BUYER_DIRECT"),
  cost("INSPECTION","0.2","BUYER_DIRECT"),
  cost("PAYMENT_RAIL","0.3","BUYER_DIRECT"),
  cost("TAX_CHARGE","0.5","BUYER_DIRECT"),
  cost("RISK_RESERVE","0.5","BUYER_DIRECT"),
],decimal("84.5"),decimal("3"));
if(exw.supplierEntitlementPerKg!=="78"||exw.settlementGrossPerKg!=="81"||exw.buyerDirectPerKg!=="3.5"||exw.buyerAllInPerKg!=="84.5")throw new Error(`EXW waterfall wrong ${JSON.stringify(exw)}`);
const delivered=buildFinalWaterfall([
  cost("SUPPLIER_NET","78","SUPPLIER_ENTITLEMENT","BUYER","SUPPLIER"),
  cost("FREIGHT","2","SUPPLIER_DIRECT","SUPPLIER","SUPPLIER"),
  cost("INSPECTION","0.2","BUYER_DIRECT"),
  cost("PAYMENT_RAIL","0.3","BUYER_DIRECT"),
  cost("TAX_CHARGE","0.5","BUYER_DIRECT"),
  cost("RISK_RESERVE","0.5","BUYER_DIRECT"),
],decimal("84.5"),decimal("3"));
if(delivered.supplierEntitlementPerKg!=="80"||delivered.settlementGrossPerKg!=="83")throw new Error("delivered waterfall wrong");
let rejected=0;
try{buildFinalWaterfall([cost("SUPPLIER_NET","78","SUPPLIER_ENTITLEMENT","BUYER","SUPPLIER"),cost("FREIGHT","2","THIRD_PARTY_ALLOCATION","BUYER","THIRD_PARTY")],decimal("83"),decimal("3"))}catch{rejected++}
try{buildFinalWaterfall([cost("SUPPLIER_NET","78","SUPPLIER_ENTITLEMENT","BUYER","SUPPLIER")],decimal("82"),decimal("3"))}catch{rejected++}
if(rejected!==2)throw new Error("invalid waterfalls accepted");
console.log("WATERFALL_OK exw_supplier=78 exw_settlement=81 buyer_direct=3.5 delivered_supplier=80 invalid=2");
