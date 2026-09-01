import type { Pool } from "pg";
import type { ImmutableEvidenceStore } from "./object_store.js";
import {
  ProductionSettlementHttpAdapter,
  bankEscrowRequest,
  cashfreeOrderRequest,
  escrowComRequest,
  lcProceedsRequest,
  razorpayOrderRequest,
  type ProviderHttpConfig,
  type SettlementRequestBuilder,
} from "../connectors/settlement_http.js";
import type { ProviderApproval, ProviderCredentials } from "../settlement.js";
import { decimal } from "../money.js";

interface ProviderEnvironmentConfig extends ProviderHttpConfig {
  readonly credentialSecretReference: string;
  readonly credentialVerifiedAt: string;
}
const builders: Readonly<Record<string, SettlementRequestBuilder>> =
  Object.freeze({
    ESCROW_COM: escrowComRequest,
    INDIAN_BANK_ESCROW: bankEscrowRequest,
    CASHFREE_EASY_SPLIT: cashfreeOrderRequest,
    RAZORPAY_ROUTE: razorpayOrderRequest,
    LC_PROCEEDS: lcProceedsRequest,
  });

export async function buildProductionSettlementAdapters(
  pool: Pool,
  store: ImmutableEvidenceStore,
  serializedConfig: string | undefined,
): Promise<readonly ProductionSettlementHttpAdapter[]> {
  if (!serializedConfig) return Object.freeze([]);
  const definitions = JSON.parse(
    serializedConfig,
  ) as ProviderEnvironmentConfig[];
  if (!Array.isArray(definitions) || definitions.length > 10)
    throw new Error("settlement provider configuration invalid");
  const adapters: ProductionSettlementHttpAdapter[] = [];
  for (const definition of definitions) {
    const builder = builders[definition.provider];
    if (!builder)
      throw new Error(
        `unsupported production settlement provider: ${definition.provider}`,
      );
    if (
      !definition.baseUrl.startsWith("https://") ||
      !definition.authorizationHeader ||
      (definition.provider !== "ESCROW_COM" && !definition.webhookSecret) ||
      !definition.credentialSecretReference
    )
      throw new Error(
        `provider secrets/config incomplete: ${definition.provider}`,
      );
    if (
      definition.provider === "CASHFREE_EASY_SPLIT" &&
      (!definition.cashfreeSplitPathTemplate?.includes("{order_id}") ||
        !definition.cashfreeSplitVerificationPathTemplate?.includes(
          "{order_id}",
        ))
    )
      throw new Error(
        "Cashfree split creation and exact verification paths required",
      );
    if (
      Object.values(definition.webhookEventTypeMap ?? {}).includes(
        "ENTITLEMENT_SECURED",
      ) &&
      !["CASHFREE_EASY_SPLIT", "RAZORPAY_ROUTE"].includes(
        definition.provider,
      ) &&
      (!definition.webhookSupplierBeneficiaryPath ||
        !definition.webhookSablestoneBeneficiaryPath ||
        !definition.webhookSupplierAmountPath ||
        !definition.webhookSablestoneAmountPath)
    )
      throw new Error(
        "provider entitlement beneficiary and allocation paths required",
      );
    const verifiedAt = Date.parse(definition.credentialVerifiedAt);
    if (
      !Number.isFinite(verifiedAt) ||
      verifiedAt > Date.now() ||
      verifiedAt < Date.now() - 30 * 86400_000
    )
      throw new Error(
        `provider credential verification stale: ${definition.provider}`,
      );
    const row = (
      await pool.query(
        "select pa.* from provider_approvals pa join authority_receipts ar on ar.receipt_id=pa.written_approval_receipt_id where pa.provider=$1 and pa.environment='PRODUCTION' and pa.state='APPROVED' and pa.valid_from<=now() and pa.valid_until>now() and ar.authority_kind='PROVIDER_WRITTEN_APPROVAL' and ar.effective_at<=now() and ar.expires_at>now() order by pa.valid_from desc limit 1",
        [definition.provider],
      )
    ).rows[0];
    if (!row) continue;
    const approval: ProviderApproval = {
        approvalId: row.id,
        provider: row.provider,
        environment: "PRODUCTION",
        writtenApprovalReceiptId: row.written_approval_receipt_id,
        actualUseCase: row.actual_use_case,
        commodityFamilies: row.commodity_families,
        currencies: row.currencies,
        minimumGross: decimal(String(row.minimum_gross)),
        maximumGross: decimal(String(row.maximum_gross)),
        capabilities: row.capabilities,
        validFrom: new Date(row.valid_from).toISOString(),
        validUntil: new Date(row.valid_until).toISOString(),
        state: row.state,
      },
      credentials: ProviderCredentials = {
        provider: definition.provider,
        environment: "PRODUCTION",
        state: "VALID",
        secretReference: definition.credentialSecretReference,
        verifiedAt: definition.credentialVerifiedAt,
      };
    adapters.push(
      new ProductionSettlementHttpAdapter(
        definition.provider,
        approval,
        credentials,
        definition,
        builder,
        store,
      ),
    );
  }
  return Object.freeze(adapters);
}
