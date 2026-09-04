import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import {
  addDecimal,
  decimal,
  divideDecimal,
  subtractDecimal,
} from "../money.js";
import { compareDecimalStrings } from "../domain.js";
import type { ImmutableEvidenceStore } from "./object_store.js";
import {
  bankEventFields,
  type BankWebhookConfig,
} from "../connectors/bank_http.js";
import { inTransaction, TransactionalOutboxRepository } from "./database.js";
import type { CredentialUseGuard } from "./production_credentials.js";
import type { AuthorityUseGuard } from "./authority_receipts.js";

export function createBankInboxProcessor(input: {
  pool: Pool;
  store: ImmutableEvidenceStore;
  config: BankWebhookConfig;
  credentialGuard?: CredentialUseGuard;
  authorityGuard?: AuthorityUseGuard;
}) {
  return async (event: QueryResultRow) => {
    await input.authorityGuard?.assertCurrent();
    await input.credentialGuard?.assertCurrent();
    const raw = await input.store.readVerified(
        String(event.payload_object_key),
        String(event.payload_digest),
      ),
      fields = bankEventFields(
        input.config,
        JSON.parse(new TextDecoder().decode(raw)),
      ),
      bankReference = required(fields.bankReference, "bank reference"),
      beneficiary = required(fields.beneficiaryId, "beneficiary"),
      currency = required(fields.currency, "currency").toUpperCase(),
      valueAt = required(fields.valueAt, "value date"),
      amount = decimal(required(fields.amount, "amount"));
    if (!/^[A-Z]{3}$/.test(currency) || Number.isNaN(Date.parse(valueAt)))
      throw new Error("bank event values invalid");
    if (
      !(
        await input.pool.query(
          "select 1 from organizations where organization_type='SABLESTONE' and id=$1",
          [beneficiary],
        )
      ).rowCount
    )
      throw new Error("bank receipt beneficiary is not SableStone");
    await input.pool.query(
      "insert into bank_receipt_events(id,provider,external_event_id,bank_reference,beneficiary_organization_id,amount,currency,value_at,payload_sha256,payload_object_key) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(provider,external_event_id) do nothing",
      [
        randomUUID(),
        input.config.provider,
        event.external_event_id,
        bankReference,
        beneficiary,
        amount,
        currency,
        valueAt,
        event.payload_digest,
        event.payload_object_key,
      ],
    );
  };
}
function required(value: unknown, label: string): string {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !String(value).trim()
  )
    throw new Error(`${label} missing`);
  return String(value);
}

export async function reconcileTradeAccounting(
  pool: Pool,
  tradeId: string,
): Promise<
  "UNKNOWN" | "PROVIDER_ONLY" | "BANK_PARTIAL" | "MISMATCH" | "RECONCILED"
> {
  return inTransaction(pool, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `accounting:${tradeId}`,
    ]);
    const facts = (
      await client.query(
        "select t.state,f.sablestone_entitlement expected,f.currency,f.provider_reference from trades t join fee_locks f on f.trade_id=t.id where t.id=$1",
        [tradeId],
      )
    ).rows[0];
    if (!facts || !["ACCEPTED", "SETTLED", "RECURRING"].includes(facts.state))
      return "UNKNOWN";
    const policy = (
      await client.query(
        "select p.* from brokerage_tax_policies p join authority_receipts a on a.receipt_id=p.authority_receipt_id where p.currency=$1 and p.effective_at<=now() and p.expires_at>now() and a.authority_kind='TAX_POLICY_APPROVAL' and a.retrieved_at<=now() and a.effective_at<=now() and a.expires_at>now() order by p.effective_at desc limit 1",
        [facts.currency],
      )
    ).rows[0];
    if (!policy || !policy.tax_inclusive) return "UNKNOWN";
    let invoice = (
      await client.query(
        "select * from invoices where trade_id=$1 and invoice_kind='BROKERAGE_SERVICE' order by created_at desc limit 1",
        [tradeId],
      )
    ).rows[0];
    if (!invoice) {
      const gross = decimal(String(facts.expected)),
        net = divideDecimal(
          gross,
          addDecimal(decimal("1"), decimal(String(policy.tax_rate))),
          6,
        ),
        tax = subtractDecimal(gross, net),
        id = randomUUID(),
        transactionId = randomUUID();
      invoice = (
        await client.query(
          "insert into invoices(id,trade_id,invoice_kind,gross,net,tax,currency,tax_policy_version,material_invoice,created_at) values($1,$2,'BROKERAGE_SERVICE',$3,$4,$5,$6,$7,false,now()) returning *",
          [id, tradeId, gross, net, tax, facts.currency, policy.version],
        )
      ).rows[0];
      await client.query(
        "insert into ledger_transactions(id,idempotency_key,trade_id,event_type,occurred_at) values($1,$2,$3,'BROKERAGE_INVOICED',now())",
        [transactionId, `invoice:${id}`, tradeId],
      );
      for (const [account, direction, amount] of [
        ["BROKERAGE_RECEIVABLE", "DEBIT", gross],
        ["BROKERAGE_REVENUE", "CREDIT", net],
        ["GST_TAX_LIABILITY", "CREDIT", tax],
      ])
        await client.query(
          "insert into ledger_entries(id,transaction_id,account_code,direction,amount,currency,external_reference) values($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            transactionId,
            account,
            direction,
            amount,
            facts.currency,
            id,
          ],
        );
    }
    const providerRows = (
        await client.query(
          "select id,amount,currency,provider_reference,bank_reference from settlement_provider_events where trade_id=$1 and event_type='DISBURSEMENT_REPORTED' order by occurred_at,id",
          [tradeId],
        )
      ).rows,
      bankRows = (
        await client.query(
          "select b.id,b.amount,b.currency,b.bank_reference from bank_receipt_events b where exists(select 1 from settlement_provider_events p where p.trade_id=$1 and p.event_type='DISBURSEMENT_REPORTED' and p.bank_reference=b.bank_reference) order by b.id for update",
          [tradeId],
        )
      ).rows;
    for(const row of providerRows)await client.query("insert into settlement_allocation_links(id,trade_id,source_kind,source_reference,amount,currency) values($1,$2,'PROVIDER_ENTRY',$3,$4,$5) on conflict(source_kind,source_reference,trade_id) do nothing",[randomUUID(),tradeId,row.id,row.amount,row.currency]);
    let bankNeeded=decimal(String(facts.expected));
    const existingBank=(await client.query("select coalesce(sum(amount),0) amount from settlement_allocation_links where trade_id=$1 and source_kind='BANK_ENTRY'",[tradeId])).rows[0];
    bankNeeded=subtractDecimal(bankNeeded,decimal(String(existingBank.amount)));
    for(const row of bankRows){
      if(compareDecimalStrings(bankNeeded,decimal("0"))<=0)break;
      const allocated=(await client.query("select coalesce(sum(amount),0) amount from settlement_allocation_links where source_kind='BANK_ENTRY' and source_reference=$1",[row.id])).rows[0],sourceRemaining=subtractDecimal(decimal(String(row.amount)),decimal(String(allocated.amount)));
      if(compareDecimalStrings(sourceRemaining,decimal("0"))<=0)continue;
      const amount=compareDecimalStrings(sourceRemaining,bankNeeded)<0?sourceRemaining:bankNeeded;
      await client.query("insert into settlement_allocation_links(id,trade_id,source_kind,source_reference,amount,currency) values($1,$2,'BANK_ENTRY',$3,$4,$5) on conflict(source_kind,source_reference,trade_id) do nothing",[randomUUID(),tradeId,row.id,amount,row.currency]);
      bankNeeded=subtractDecimal(bankNeeded,amount);
    }
    const allocatedBankRows=(await client.query("select l.amount,l.currency,b.bank_reference from settlement_allocation_links l join bank_receipt_events b on b.id::text=l.source_reference where l.trade_id=$1 and l.source_kind='BANK_ENTRY' order by l.linked_at",[tradeId])).rows;
    const provider = providerRows.length?{amount:providerRows.reduce((total,row)=>addDecimal(total,decimal(String(row.amount))),decimal("0")),currency:providerRows.every(row=>row.currency===facts.currency)?facts.currency:"MIXED",provider_reference:providerRows.map(row=>row.provider_reference).join(","),bank_reference:providerRows.map(row=>row.bank_reference).filter(Boolean).join(",")}:null,
      bank = allocatedBankRows.length?{amount:allocatedBankRows.reduce((total,row)=>addDecimal(total,decimal(String(row.amount))),decimal("0")),currency:allocatedBankRows.every(row=>row.currency===facts.currency)?facts.currency:"MIXED",bank_reference:allocatedBankRows.map(row=>row.bank_reference).join(",")}:null;
    let state: "PROVIDER_ONLY" | "BANK_PARTIAL" | "MISMATCH" | "RECONCILED" =
      "PROVIDER_ONLY";
    if (provider && bank) {
      const bankComparison = compareDecimalStrings(
          decimal(String(bank.amount)),
          decimal(String(facts.expected)),
        ),
        providerComparison = compareDecimalStrings(
          decimal(String(provider.amount)),
          decimal(String(facts.expected)),
        );
      state =
        providerComparison === 0 &&
        bankComparison === 0 &&
        provider.currency === facts.currency &&
        bank.currency === facts.currency
          ? "RECONCILED"
          : bankComparison < 0 &&
              compareDecimalStrings(
                decimal(String(bank.amount)),
                decimal("0"),
              ) > 0
            ? "BANK_PARTIAL"
            : "MISMATCH";
    }
    await client.query(
      "insert into reconciliation_results(trade_id,state,expected,provider_disbursed,bank_received,provider_reference,bank_reference,evaluated_at) values($1,$2,$3,$4,$5,$6,$7,now()) on conflict(trade_id) do update set state=excluded.state,provider_disbursed=excluded.provider_disbursed,bank_received=excluded.bank_received,provider_reference=excluded.provider_reference,bank_reference=excluded.bank_reference,evaluated_at=excluded.evaluated_at",
      [
        tradeId,
        state,
        facts.expected,
        provider?.amount ?? null,
        bank?.amount ?? null,
        provider?.provider_reference ?? null,
        bank?.bank_reference ?? null,
      ],
    );
    if (state === "RECONCILED" && facts.state === "ACCEPTED" && bank && provider) {
      const transactionId = randomUUID();
      await client.query(
        "insert into ledger_transactions(id,idempotency_key,trade_id,event_type,occurred_at) values($1,$2,$3,'BROKERAGE_BANK_RECEIVED',now()) on conflict(idempotency_key) do nothing",
        [transactionId, `bank:${tradeId}:${bank.bank_reference}`, tradeId],
      );
      if (
        (
          await client.query("select 1 from ledger_transactions where id=$1", [
            transactionId,
          ])
        ).rowCount
      )
        for (const [account, direction] of [
          ["SABLESTONE_BANK_CASH", "DEBIT"],
          ["BROKERAGE_RECEIVABLE", "CREDIT"],
        ])
          await client.query(
            "insert into ledger_entries(id,transaction_id,account_code,direction,amount,currency,external_reference) values($1,$2,$3,$4,$5,$6,$7)",
            [
              randomUUID(),
              transactionId,
              account,
              direction,
              facts.expected,
              facts.currency,
              bank.bank_reference,
            ],
          );
      await client.query(
        "update trades set state='SETTLED',updated_at=now() where id=$1 and state='ACCEPTED'",
        [tradeId],
      );
      const outbox = new TransactionalOutboxRepository(pool);
      await outbox.append(client, {
        id: randomUUID(),
        aggregateType: "TRADE",
        aggregateId: tradeId,
        eventType: "TRADE_SETTLED",
        payload: {
          bankReference: bank.bank_reference,
          providerReference: provider.provider_reference,
        },
        idempotencyKey: `trade:${tradeId}:settled`,
      });
    }
    return state;
  });
}
