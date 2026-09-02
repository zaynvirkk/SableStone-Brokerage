import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { inTransaction, TransactionalOutboxRepository } from "./database.js";
export class ProductionCommandService {
  readonly outbox: TransactionalOutboxRepository;
  constructor(readonly pool: Pool) {
    this.outbox = new TransactionalOutboxRepository(pool);
  }
  async acceptAgreement(input: {
    agreementId: string;
    agreementVersion: string;
    agreementBindingId: string;
    organizationId: string;
    userId: string;
    authChallengeId: string;
    authExpiresAt: string;
    acceptedAt: string;
    ipAddressCiphertext: Uint8Array;
    userAgentDigest: string;
  }): Promise<{ acceptanceId: string; acceptanceDigest: string }> {
    return inTransaction(this.pool, async (client) => {
      const agreement = (
        await client.query(
          "select a.*,b.id agreement_binding_id,b.resource_type,b.resource_id,b.binding_sha256 from agreements a join agreement_resource_bindings b on b.agreement_id=a.id and b.agreement_version=a.version join authority_receipts legal on legal.receipt_id=b.legal_gate_receipt_id where a.id=$1 and a.version=$2 and b.id=$3 and b.expected_organization_id=$4 and legal.authority_kind in('LEGAL_AGREEMENT_APPROVAL','LEGAL_AGREEMENT_TEMPLATE') and legal.retrieved_at<=$5 and legal.effective_at<=$5 and legal.expires_at>$5 and a.effective_at<=$5 and a.expires_at>$5",
          [
            input.agreementId,
            input.agreementVersion,
            input.agreementBindingId,
            input.organizationId,
            input.acceptedAt,
          ],
        )
      ).rows[0];
      if (!agreement) throw new Error("current agreement unavailable");
      if (
        !/^[0-9a-f]{64}$/.test(input.userAgentDigest) ||
        Date.parse(input.acceptedAt) >= Date.parse(input.authExpiresAt)
      )
        throw new Error("acceptance authentication invalid");
      const idempotencyKey = `agreement:${input.agreementId}:${input.agreementVersion}:${agreement.agreement_binding_id}:${input.organizationId}:${input.userId}:${input.authChallengeId}`,
        prior = (
          await client.query(
            "select id,acceptance_sha256 from agreement_acceptances where idempotency_key=$1",
            [idempotencyKey],
          )
        ).rows[0];
      if (prior)
        return {
          acceptanceId: prior.id,
          acceptanceDigest: prior.acceptance_sha256,
        };
      const acceptanceDigest = createHash("sha256")
          .update(
            JSON.stringify({
              agreementId: input.agreementId,
              version: input.agreementVersion,
              bodySha256: agreement.body_sha256,
              bindingId: agreement.agreement_binding_id,
              bindingSha256: agreement.binding_sha256,
              organizationId: input.organizationId,
              userId: input.userId,
              authChallengeId: input.authChallengeId,
              acceptedAt: input.acceptedAt,
            }),
          )
          .digest("hex"),
        id = randomUUID();
      await client.query(
        "insert into agreement_acceptances(id,idempotency_key,agreement_id,agreement_version,agreement_body_sha256,agreement_binding_id,expected_organization_id,signer_organization_id,signer_user_id,signer_email_verified,otp_challenge_id,otp_verified,otp_expires_at,accepted_at,ip_address_ciphertext,user_agent_digest,acceptance_sha256) values($1,$2,$3,$4,$5,$6,$7,$7,$8,true,$9,true,$10,$11,$12,$13,$14)",
        [
          id,
          idempotencyKey,
          input.agreementId,
          input.agreementVersion,
          agreement.body_sha256,
          agreement.agreement_binding_id,
          input.organizationId,
          input.userId,
          input.authChallengeId,
          input.authExpiresAt,
          input.acceptedAt,
          Buffer.from(input.ipAddressCiphertext),
          input.userAgentDigest,
          acceptanceDigest,
        ],
      );
      return { acceptanceId: id, acceptanceDigest };
    });
  }
  async acceptProtectedMatch(input: {
    matchId: string;
    organizationId: string;
    role: "SUPPLIER" | "BUYER";
    agreementAcceptanceId: string;
    acceptedAt: string;
  }): Promise<string> {
    return inTransaction(this.pool, async (client) => {
      const match = (
        await client.query(
          "select m.*,o.supplier_id,d.buyer_id from matches m join supplier_offers o on o.id=m.offer_id and o.version=m.offer_version join buyer_demands d on d.id=m.demand_id and d.version=m.demand_version where m.id=$1 and m.compatible",
          [input.matchId],
        )
      ).rows[0];
      if (!match) throw new Error("compatible match unavailable");
      const expected =
        input.role === "SUPPLIER" ? match.supplier_id : match.buyer_id;
      if (expected !== input.organizationId)
        throw new Error("protected acceptance organization mismatch");
      const agreement = (
        await client.query(
          "select aa.* from agreement_acceptances aa join agreements a on a.id=aa.agreement_id and a.version=aa.agreement_version and a.body_sha256=aa.agreement_body_sha256 join agreement_resource_bindings b on b.id=aa.agreement_binding_id and b.agreement_id=a.id and b.agreement_version=a.version where aa.id=$1 and aa.signer_organization_id=$2 and aa.expected_organization_id=$2 and b.expected_organization_id=$2 and b.resource_type='MATCH' and b.resource_id=$3 and b.role=$4 and aa.accepted_at<aa.otp_expires_at and a.effective_at<=$5 and a.expires_at>$5 and a.agreement_kind=$6",
          [
            input.agreementAcceptanceId,
            input.organizationId,
            input.matchId,
            input.role,
            input.acceptedAt,
            input.role === "SUPPLIER"
              ? "PROTECTED_ACCOUNT_NOTICE"
              : "PROTECTED_SUPPLIER_ACKNOWLEDGEMENT",
          ],
        )
      ).rows[0];
      if (!agreement) throw new Error("current agreement acceptance missing");
      const masterKind =
          input.role === "SUPPLIER"
            ? "SUPPLIER_MASTER_BROKERAGE"
            : "BUYER_ACCESS_TERMS",
        master = (
          await client.query(
            "select 1 from agreement_acceptances aa join agreements a on a.id=aa.agreement_id and a.version=aa.agreement_version and a.body_sha256=aa.agreement_body_sha256 join agreement_resource_bindings b on b.id=aa.agreement_binding_id and b.agreement_id=a.id and b.agreement_version=a.version where aa.signer_organization_id=$1 and b.expected_organization_id=$1 and b.resource_type='ORG_MASTER' and b.resource_id=$1 and b.role=$3 and a.agreement_kind=$2 and a.effective_at<=$4 and a.expires_at>$4 order by aa.accepted_at desc limit 1",
            [input.organizationId, masterKind, input.role, input.acceptedAt],
          )
        ).rows[0];
      if (!master)
        throw new Error("current master agreement acceptance missing");
      const digest = createHash("sha256")
          .update(
            JSON.stringify({
              matchId: input.matchId,
              organizationId: input.organizationId,
              role: input.role,
              agreementDigest: agreement.acceptance_sha256,
              acceptedAt: input.acceptedAt,
            }),
          )
          .digest("hex"),
        id = randomUUID();
      const prior = (
        await client.query(
          "select organization_id,agreement_acceptance_id,acceptance_digest from protected_match_acceptances where match_id=$1 and role=$2",
          [input.matchId, input.role],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.organization_id !== input.organizationId ||
          prior.agreement_acceptance_id !== input.agreementAcceptanceId ||
          prior.acceptance_digest !== digest
        )
          throw new Error("protected acceptance conflict");
        return prior.acceptance_digest;
      }
      await client.query(
        "insert into protected_match_acceptances(id,match_id,role,organization_id,agreement_acceptance_id,acceptance_digest,accepted_at) values($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          input.matchId,
          input.role,
          input.organizationId,
          input.agreementAcceptanceId,
          digest,
          input.acceptedAt,
        ],
      );
      const both =
        Number(
          (
            await client.query(
              "select count(*)::int as count from protected_match_acceptances where match_id=$1",
              [input.matchId],
            )
          ).rows[0].count,
        ) === 2;
      if (both)
        await this.outbox.append(client, {
          id: randomUUID(),
          aggregateType: "MATCH",
          aggregateId: input.matchId,
          eventType: "PROTECTED_ACCEPTANCES_COMPLETE",
          payload: { matchId: input.matchId },
          idempotencyKey: `match:${input.matchId}:protected-acceptances`,
        });
      return digest;
    });
  }
  async acceptSettlementInstruction(input: {
    instructionId: string;
    organizationId: string;
    role: "SUPPLIER" | "BUYER";
    instructionDigest: string;
    acceptedAt: string;
  }): Promise<string> {
    if (!/^[0-9a-f]{64}$/.test(input.instructionDigest))
      throw new Error("instruction digest invalid");
    return inTransaction(this.pool, async (client) => {
      const instruction = (
        await client.query(
          "select * from settlement_instructions where id=$1 and expires_at>$2",
          [input.instructionId, input.acceptedAt],
        )
      ).rows[0];
      if (!instruction) throw new Error("settlement instruction unavailable");
      const expected =
        input.role === "SUPPLIER"
          ? instruction.supplier_id
          : instruction.buyer_id;
      if (expected !== input.organizationId)
        throw new Error("settlement acceptance organization mismatch");
      const canonical = settlementInstructionAcceptanceDigest(instruction);
      if (canonical !== input.instructionDigest)
        throw new Error("settlement instruction digest drift");
      const prior = (
        await client.query(
          "select organization_id,instruction_digest from settlement_instruction_acceptances where instruction_id=$1 and role=$2",
          [input.instructionId, input.role],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.organization_id !== input.organizationId ||
          prior.instruction_digest !== canonical
        )
          throw new Error("settlement acceptance conflict");
        return prior.instruction_digest;
      }
      await client.query(
        "insert into settlement_instruction_acceptances(id,instruction_id,role,organization_id,instruction_digest,accepted_at) values($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          input.instructionId,
          input.role,
          input.organizationId,
          input.instructionDigest,
          input.acceptedAt,
        ],
      );
      const both =
        Number(
          (
            await client.query(
              "select count(*)::int as count from settlement_instruction_acceptances where instruction_id=$1 and instruction_digest=$2",
              [input.instructionId, input.instructionDigest],
            )
          ).rows[0].count,
        ) === 2;
      if (both)
        await this.outbox.append(client, {
          id: randomUUID(),
          aggregateType: "TRADE",
          aggregateId: instruction.trade_id,
          eventType: "SETTLEMENT_ACCEPTANCES_COMPLETE",
          payload: {
            tradeId: instruction.trade_id,
            instructionId: input.instructionId,
            instructionDigest: input.instructionDigest,
          },
          idempotencyKey: `instruction:${input.instructionId}:acceptances`,
        });
      return canonical;
    });
  }
  async acceptTradeContract(input: {
    tradeId: string;
    organizationId: string;
    role: "SUPPLIER" | "BUYER";
    agreementAcceptanceId: string;
    acceptedAt: string;
  }): Promise<string> {
    return inTransaction(this.pool, async (client) => {
      const trade = (
        await client.query(
          "select * from trades where id=$1 and state in('IDENTITY_RELEASED','CONTRACTED','FUNDED') for update",
          [input.tradeId],
        )
      ).rows[0];
      if (!trade) throw new Error("identity-released trade unavailable");
      const expected =
        input.role === "SUPPLIER" ? trade.supplier_id : trade.buyer_id;
      if (expected !== input.organizationId)
        throw new Error("contract acceptance organization mismatch");
      const acceptance = (
        await client.query(
          "select aa.* from agreement_acceptances aa join agreements a on a.id=aa.agreement_id and a.version=aa.agreement_version and a.body_sha256=aa.agreement_body_sha256 join agreement_resource_bindings b on b.id=aa.agreement_binding_id and b.agreement_id=a.id and b.agreement_version=a.version where aa.id=$1 and aa.signer_organization_id=$2 and aa.expected_organization_id=$2 and b.expected_organization_id=$2 and b.resource_type='TRADE' and b.resource_id=$3 and b.role=$4 and aa.accepted_at<aa.otp_expires_at and a.agreement_kind='TRANSACTION_CONFIRMATION' and a.effective_at<=$5 and a.expires_at>$5",
          [
            input.agreementAcceptanceId,
            input.organizationId,
            input.tradeId,
            input.role,
            input.acceptedAt,
          ],
        )
      ).rows[0];
      if (!acceptance)
        throw new Error("current transaction confirmation acceptance missing");
      const prior = (
        await client.query(
          "select organization_id,agreement_acceptance_id from trade_contract_acceptances where trade_id=$1 and role=$2",
          [input.tradeId, input.role],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.organization_id !== input.organizationId ||
          prior.agreement_acceptance_id !== input.agreementAcceptanceId
        )
          throw new Error("contract acceptance conflict");
        if (trade.state !== "IDENTITY_RELEASED") return trade.state;
      } else
        await client.query(
          "insert into trade_contract_acceptances(id,trade_id,role,organization_id,agreement_acceptance_id,accepted_at) values($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            input.tradeId,
            input.role,
            input.organizationId,
            input.agreementAcceptanceId,
            input.acceptedAt,
          ],
        );
      const rows = (
        await client.query(
          "select role,agreement_acceptance_id from trade_contract_acceptances where trade_id=$1 order by role",
          [input.tradeId],
        )
      ).rows;
      if (rows.length !== 2) return "AWAITING_COUNTERPARTY";
      const digest = createHash("sha256")
          .update(JSON.stringify(rows))
          .digest("hex"),
        sablestone = (
          await client.query(
            "select id from organizations where organization_type='SABLESTONE' order by created_at limit 1",
          )
        ).rows[0];
      if (!sablestone) throw new Error("SableStone organization missing");
      await client.query(
        "insert into material_contracts(id,trade_id,seller_organization_id,buyer_organization_id,broker_organization_id,material_invoice_issuer_id,quality_obligation_owner_id,title_holder_until_transfer_id,agreement_digest,accepted_at) values($1,$2,$3,$4,$5,$3,$3,$3,$6,$7) on conflict(trade_id) do nothing",
        [
          randomUUID(),
          input.tradeId,
          trade.supplier_id,
          trade.buyer_id,
          sablestone.id,
          digest,
          input.acceptedAt,
        ],
      );
      const updated = await client.query(
        "update trades set state='CONTRACTED',updated_at=now() where id=$1 and state='IDENTITY_RELEASED'",
        [input.tradeId],
      );
      if ((updated.rowCount ?? 0) !== 1)
        throw new Error("contract transition conflict");
      await this.outbox.append(client, {
        id: randomUUID(),
        aggregateType: "TRADE",
        aggregateId: input.tradeId,
        eventType: "TRADE_CONTRACTED",
        payload: { agreementDigest: digest },
        idempotencyKey: `trade:${input.tradeId}:contracted`,
      });
      const funded = (
        await client.query(
          "select id,provider,external_event_id from settlement_provider_events where trade_id=$1 and event_type in('FUNDED','ENTITLEMENT_SECURED') order by occurred_at desc limit 1",
          [input.tradeId],
        )
      ).rows[0];
      if (funded) {
        await client.query(
          "update trades set state='FUNDED',updated_at=now() where id=$1 and state='CONTRACTED'",
          [input.tradeId],
        );
        await this.outbox.append(client, {
          id: randomUUID(),
          aggregateType: "TRADE",
          aggregateId: input.tradeId,
          eventType: "TRADE_FUNDED",
          payload: {
            provider: funded.provider,
            externalEventId: funded.external_event_id,
          },
          idempotencyKey: `trade:${input.tradeId}:funded`,
        });
        return "FUNDED";
      }
      return "CONTRACTED";
    });
  }
  async recordShipment(input: {
    tradeId: string;
    organizationId: string;
    carrierOrganizationId: string;
    responsiblePartyId: string;
    eventType: "DISPATCHED" | "IN_TRANSIT" | "DELIVERED";
    documentReceiptId: string;
    occurredAt: string;
  }): Promise<string> {
    return inTransaction(this.pool, async (client) => {
      const trade = (
        await client.query(
          "select * from trades where id=$1 and state in('FUNDED','DISPATCHED','IN_TRANSIT') for update",
          [input.tradeId],
        )
      ).rows[0];
      if (
        !trade ||
        ![trade.supplier_id, trade.buyer_id].includes(input.organizationId) ||
        input.responsiblePartyId !== input.organizationId
      )
        throw new Error("shipment authority unavailable");
      const expected =
        trade.state === "FUNDED"
          ? "DISPATCHED"
          : trade.state === "DISPATCHED"
            ? "IN_TRANSIT"
            : "DELIVERED";
      if (input.eventType !== expected)
        throw new Error("shipment sequence invalid");
      if (
        !(
          await client.query(
            "select 1 from organizations where id=$1 and organization_type='PROVIDER'",
            [input.carrierOrganizationId],
          )
        ).rowCount ||
        !(
          await client.query(
            "select 1 from documents where id=$1 and organization_id=$2",
            [input.documentReceiptId, input.organizationId],
          )
        ).rowCount
      )
        throw new Error("shipment provider or evidence invalid");
      const eventId = randomUUID();
      await client.query(
        "insert into shipment_events(event_id,trade_id,carrier_organization_id,responsible_party_id,event_type,document_receipt_id,occurred_at) values($1,$2,$3,$4,$5,$6,$7)",
        [
          eventId,
          input.tradeId,
          input.carrierOrganizationId,
          input.responsiblePartyId,
          input.eventType,
          input.documentReceiptId,
          input.occurredAt,
        ],
      );
      const updated = await client.query(
        "update trades set state=$2,updated_at=now() where id=$1 and state=$3",
        [input.tradeId, input.eventType, trade.state],
      );
      if ((updated.rowCount ?? 0) !== 1)
        throw new Error("shipment transition conflict");
      await this.outbox.append(client, {
        id: randomUUID(),
        aggregateType: "TRADE",
        aggregateId: input.tradeId,
        eventType: "SHIPMENT_EVENT_RECORDED",
        payload: { eventId, eventType: input.eventType },
        idempotencyKey: `shipment:${eventId}`,
      });
      return eventId;
    });
  }
  async acceptDelivery(input: {
    tradeId: string;
    buyerId: string;
    acceptanceKind: "ACCEPTED" | "INSPECTION_PASS" | "COA_WAIVER";
    evidenceReceiptId: string | null;
    acceptedAt: string;
  }): Promise<string> {
    return inTransaction(this.pool, async (client) => {
      const trade = (
        await client.query(
          "select * from trades where id=$1 and buyer_id=$2 and state='DELIVERED' for update",
          [input.tradeId, input.buyerId],
        )
      ).rows[0];
      if (!trade) throw new Error("delivered trade unavailable");
      const shipment = (
        await client.query(
          "select event_id from shipment_events where trade_id=$1 and event_type='DELIVERED' order by occurred_at desc limit 1",
          [input.tradeId],
        )
      ).rows[0];
      if (!shipment) throw new Error("delivery evidence missing");
      if (input.acceptanceKind !== "ACCEPTED" && !input.evidenceReceiptId)
        throw new Error("quality acceptance evidence required");
      if (
        input.evidenceReceiptId &&
        !(
          await client.query(
            "select 1 from documents where id=$1 and organization_id=$2",
            [input.evidenceReceiptId, input.buyerId],
          )
        ).rowCount
      )
        throw new Error("buyer evidence invalid");
      const id = randomUUID();
      await client.query(
        "insert into delivery_acceptances(id,trade_id,buyer_id,delivered_shipment_event_id,acceptance_kind,evidence_receipt_id,accepted_at) values($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          input.tradeId,
          input.buyerId,
          shipment.event_id,
          input.acceptanceKind,
          input.evidenceReceiptId,
          input.acceptedAt,
        ],
      );
      const updated = await client.query(
        "update trades set state='ACCEPTED',updated_at=now() where id=$1 and state='DELIVERED'",
        [input.tradeId],
      );
      if ((updated.rowCount ?? 0) !== 1)
        throw new Error("delivery acceptance conflict");
      await this.outbox.append(client, {
        id: randomUUID(),
        aggregateType: "TRADE",
        aggregateId: input.tradeId,
        eventType: "TRADE_ACCEPTED",
        payload: { deliveryAcceptanceId: id },
        idempotencyKey: `trade:${input.tradeId}:accepted`,
      });
      return id;
    });
  }
  async authorizeStandingDemand(input: {
    demandId: string;
    version: number;
    buyerId: string;
    maximumRenewals: number;
    validUntil: string;
    confirmedAt: string;
  }): Promise<string> {
    if (
      !Number.isInteger(input.maximumRenewals) ||
      input.maximumRenewals < 1 ||
      input.maximumRenewals > 120 ||
      Date.parse(input.validUntil) <= Date.parse(input.confirmedAt)
    )
      throw new Error("standing demand bounds invalid");
    return inTransaction(this.pool, async (client) => {
      const demand = (
        await client.query(
          "select * from buyer_demands where id=$1 and version=$2 and buyer_id=$3 and standing and verification='VERIFIED' and freshness='CURRENT' and expires_at>$4",
          [input.demandId, input.version, input.buyerId, input.confirmedAt],
        )
      ).rows[0];
      if (!demand) throw new Error("verified standing demand unavailable");
      const digest = createHash("sha256")
        .update(
          JSON.stringify({
            demandId: input.demandId,
            version: input.version,
            buyerId: input.buyerId,
            maximumRenewals: input.maximumRenewals,
            validUntil: input.validUntil,
            confirmedAt: input.confirmedAt,
          }),
        )
        .digest("hex");
      await client.query(
        "insert into standing_demand_authorizations(demand_id,demand_version,automatic_renewal_permitted,maximum_renewals,renewals_used,confirmed_at,valid_until,acceptance_digest) values($1,$2,true,$3,0,$4,$5,$6) on conflict(demand_id,demand_version) do nothing",
        [
          input.demandId,
          input.version,
          input.maximumRenewals,
          input.confirmedAt,
          input.validUntil,
          digest,
        ],
      );
      return digest;
    });
  }
}
export function settlementInstructionAcceptanceDigest(
  instruction: Readonly<Record<string, unknown>>,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: instruction.id,
        provider: instruction.provider,
        gross: String(instruction.gross_amount),
        supplier: String(instruction.supplier_entitlement),
        sablestone: String(instruction.sablestone_entitlement),
        buyerAllIn: String(instruction.buyer_all_in_amount),
        buyerDirectCosts: instruction.buyer_direct_costs,
        providerDeductions: instruction.provider_deductions,
        otherAllocations: instruction.other_allocations,
        finalEconomicsSnapshotId: instruction.final_economics_snapshot_id,
        waterfallDigest: instruction.waterfall_digest,
        currency: instruction.currency,
        expiresAt: new Date(String(instruction.expires_at)).toISOString(),
      }),
    )
    .digest("hex");
}
