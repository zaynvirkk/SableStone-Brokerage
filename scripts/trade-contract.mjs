import { TradeWorkflow } from "../dist/index.js";
const evidence={supplierAccepted:true,buyerAccepted:true,commissionLocked:true,settlementAvailable:true,identityReleased:true,supplierIsSeller:true,sablestoneHasCustody:false};
const ids={tradeId:"trade-1",supplierId:"supplier-1",buyerId:"buyer-1",sablestoneId:"sablestone-1"};
const contract={contractId:"c1",tradeId:ids.tradeId,sellerOrganizationId:ids.supplierId,buyerOrganizationId:ids.buyerId,brokerOrganizationId:ids.sablestoneId,materialInvoiceIssuerId:ids.supplierId,qualityObligationOwnerId:ids.supplierId,titleHolderUntilTransferId:ids.supplierId,agreementDigest:"a".repeat(64),acceptedAt:"2026-08-31T00:00:00Z"};
const flow=new TradeWorkflow(...Object.values(ids)); flow.contract(contract,evidence); flow.fund({provider:"fixture-bank",providerReference:"fund-1",purchaseFundsCustodian:"fixture-bank",fundedAt:"2026-08-31T00:01:00Z",signatureVerified:true},evidence);
flow.shipment({eventId:"s1",carrierOrganizationId:"carrier-1",responsiblePartyId:ids.supplierId,eventType:"DISPATCHED",documentReceiptId:"dispatch-doc",occurredAt:"2026-08-31T01:00:00Z"},evidence);
flow.shipment({eventId:"s2",carrierOrganizationId:"carrier-1",responsiblePartyId:ids.supplierId,eventType:"IN_TRANSIT",documentReceiptId:"transit-doc",occurredAt:"2026-08-31T02:00:00Z"},evidence);
flow.inspect({inspectionProviderId:"inspector-1",engagedByOrganizationId:ids.buyerId,paidByOrganizationId:ids.buyerId,certificateReceiptId:"inspection-cert",verdict:"PASS",occurredAt:"2026-08-31T02:30:00Z"});
flow.shipment({eventId:"s3",carrierOrganizationId:"carrier-1",responsiblePartyId:ids.supplierId,eventType:"DELIVERED",documentReceiptId:"delivery-doc",occurredAt:"2026-08-31T03:00:00Z"},evidence); flow.accept(evidence); flow.settle(evidence);
if(flow.state()!=="SETTLED") throw new Error("trade lifecycle failed"); let rejected=0;
for(const action of [
 ()=>new TradeWorkflow(...Object.values(ids)).contract({...contract,sellerOrganizationId:ids.sablestoneId},evidence),
 ()=>{const f=new TradeWorkflow(...Object.values(ids));f.contract(contract,evidence);f.fund({provider:"x",providerReference:"r",purchaseFundsCustodian:ids.sablestoneId,fundedAt:"x",signatureVerified:true},evidence)},
 ()=>{const f=new TradeWorkflow(...Object.values(ids));f.contract(contract,evidence);f.fund({provider:"x",providerReference:"r",purchaseFundsCustodian:"bank",fundedAt:"x",signatureVerified:true},evidence);f.shipment({eventId:"s",carrierOrganizationId:ids.sablestoneId,responsiblePartyId:ids.supplierId,eventType:"DISPATCHED",documentReceiptId:"d",occurredAt:"x"},evidence)},
 ()=>flow.inspect({inspectionProviderId:ids.sablestoneId,engagedByOrganizationId:ids.buyerId,paidByOrganizationId:ids.buyerId,certificateReceiptId:"c",verdict:"PASS",occurredAt:"x"}),
])try{action()}catch{rejected++}
if(rejected!==4) throw new Error("principal boundary failed open"); console.log("TRADE_OK direct_contract=true supplier_seller=true external_funding=true external_shipment=true external_inspection=true states=settled principal_mutations=4");
