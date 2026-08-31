import type { GateEvaluation } from "./authority.js";
import { compareDecimalStrings } from "./domain.js";
import { addDecimal, decimal, divideDecimal, subtractDecimal, type DecimalString } from "./money.js";

export type LedgerAccountCode = "BROKERAGE_RECEIVABLE" | "BROKERAGE_REVENUE" | "GST_TAX_LIABILITY" | "SABLESTONE_BANK_CASH" | "PROVIDER_FEE_EXPENSE" | "SUSPENSE" | "FX_GAIN_LOSS";
export interface LedgerLine { readonly account: LedgerAccountCode; readonly direction: "DEBIT" | "CREDIT"; readonly amount: DecimalString; readonly currency: string; readonly externalReference: string; }
export interface LedgerTransaction { readonly transactionId: string; readonly idempotencyKey: string; readonly tradeId: string; readonly eventType: string; readonly occurredAt: string; readonly lines: readonly LedgerLine[]; readonly reversesTransactionId: string | null; }
export class DoubleEntryLedger {
  readonly #transactions = new Map<string, Readonly<LedgerTransaction>>();
  post(transaction: LedgerTransaction): Readonly<LedgerTransaction> {
    const previous=this.#transactions.get(transaction.idempotencyKey);if(previous){if(previous.transactionId!==transaction.transactionId)throw new Error("ledger idempotency conflict");return previous;}
    if(transaction.lines.length<2)throw new Error("double entry requires at least two lines");
    const currencies=new Set(transaction.lines.map(l=>l.currency));if(currencies.size!==1)throw new Error("ledger transaction cannot net currencies");
    let debit=decimal("0"),credit=decimal("0");for(const line of transaction.lines){if(line.amount.startsWith("-")||!line.externalReference.trim())throw new Error("invalid ledger line");if(line.direction==="DEBIT")debit=addDecimal(debit,line.amount);else credit=addDecimal(credit,line.amount);}
    if(compareDecimalStrings(debit,credit)!==0)throw new Error("unbalanced ledger transaction");
    const stored=Object.freeze({...transaction,lines:Object.freeze(transaction.lines.map(l=>Object.freeze({...l})))});this.#transactions.set(transaction.idempotencyKey,stored);return stored;
  }
  count():number{return this.#transactions.size;}
}
export interface TaxPolicy { readonly version:string;readonly currency:string;readonly taxRate:DecimalString;readonly brokerageInvoiceTaxInclusive:boolean;readonly authorityReceiptId:string; }
export interface BrokerageInvoice { readonly invoiceId:string;readonly tradeId:string;readonly kind:"BROKERAGE_SERVICE";readonly gross:DecimalString;readonly net:DecimalString;readonly tax:DecimalString;readonly currency:string;readonly taxPolicyVersion:string;readonly materialInvoice:false; }
export function issueBrokerageInvoice(invoiceId:string,tradeId:string,gross:DecimalString,policy:TaxPolicy,taxGate:GateEvaluation):BrokerageInvoice{
 if(taxGate.state!=="AVAILABLE"||taxGate.receiptId!==policy.authorityReceiptId)throw new Error("current tax authority gate required");
 if(!policy.brokerageInvoiceTaxInclusive)throw new Error("fixture supports explicitly configured tax-inclusive brokerage only");
 const divisor=addDecimal(decimal("1"),policy.taxRate),net=divideDecimal(gross,divisor,6),tax=subtractDecimal(gross,net);
 return Object.freeze({invoiceId,tradeId,kind:"BROKERAGE_SERVICE",gross,net,tax,currency:policy.currency,taxPolicyVersion:policy.version,materialInvoice:false});
}
export function invoiceLedgerTransaction(invoice:BrokerageInvoice):LedgerTransaction{const lines:readonly LedgerLine[]=Object.freeze([
 {account:"BROKERAGE_RECEIVABLE",direction:"DEBIT",amount:invoice.gross,currency:invoice.currency,externalReference:invoice.invoiceId},
 {account:"BROKERAGE_REVENUE",direction:"CREDIT",amount:invoice.net,currency:invoice.currency,externalReference:invoice.invoiceId},
 {account:"GST_TAX_LIABILITY",direction:"CREDIT",amount:invoice.tax,currency:invoice.currency,externalReference:invoice.invoiceId},
]);return Object.freeze({transactionId:`ledger:${invoice.invoiceId}`,idempotencyKey:`invoice:${invoice.invoiceId}`,tradeId:invoice.tradeId,eventType:"BROKERAGE_INVOICED",occurredAt:"2026-08-31T00:00:00Z",reversesTransactionId:null,lines});}
export type ReconciliationState="PROVIDER_ONLY"|"BANK_PARTIAL"|"RECONCILED"|"MISMATCH";
export function reconcileBrokerage(expected:DecimalString,providerDisbursed:DecimalString|null,bankReceived:DecimalString|null,providerReference:string|null,bankReference:string|null):ReconciliationState{
 if(providerDisbursed===null||!providerReference)return "PROVIDER_ONLY";
 if(bankReceived===null||!bankReference)return "PROVIDER_ONLY";
 if(compareDecimalStrings(bankReceived,expected)===0&&compareDecimalStrings(providerDisbursed,expected)===0)return "RECONCILED";
 if(compareDecimalStrings(bankReceived,expected)<0&&compareDecimalStrings(bankReceived,decimal("0"))>0)return "BANK_PARTIAL";
 return "MISMATCH";
}
export function bankReceiptTransaction(tradeId:string,amount:DecimalString,currency:string,bankReference:string):LedgerTransaction{const lines:readonly LedgerLine[]=Object.freeze([{account:"SABLESTONE_BANK_CASH",direction:"DEBIT",amount,currency,externalReference:bankReference},{account:"BROKERAGE_RECEIVABLE",direction:"CREDIT",amount,currency,externalReference:bankReference}]);return Object.freeze({transactionId:`bank:${bankReference}`,idempotencyKey:`bank:${bankReference}`,tradeId,eventType:"BROKERAGE_BANK_RECEIVED",occurredAt:"2026-08-31T00:00:01Z",reversesTransactionId:null,lines});}
