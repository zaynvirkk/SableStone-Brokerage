import type { Pool } from "pg";
import {
  BraveSearchConnector,
  type SearchApproval,
} from "../connectors/acquisition_graph.js";
import type { ImmutableEvidenceStore } from "./object_store.js";
import {
  assertCurrentAuthorityReceipt,
  DatabaseAuthorityUseGuard,
} from "./authority_receipts.js";
import {
  assertCurrentCredentialBinding,
  DatabaseCredentialUseGuard,
} from "./production_credentials.js";

interface BraveRuntimeConfig extends SearchApproval {
  readonly approvalReceiptId: string;
}

export async function buildBraveSearchConnector(
  pool: Pool,
  store: ImmutableEvidenceStore,
  serialized: string | undefined,
): Promise<BraveSearchConnector | null> {
  if (!serialized) return null;
  const config = JSON.parse(serialized) as BraveRuntimeConfig;
  if (config.provider !== "BRAVE" || !config.apiKey)
    throw new Error("Brave production configuration incomplete");
  await assertCurrentAuthorityReceipt(
    pool,
    config.approvalReceiptId,
    "SEARCH_PROVIDER_APPROVAL",
  );
  const credentialInput = {
    provider: "BRAVE",
    capability: "SEARCH_API",
    environment: "PRODUCTION",
    credentialParts: [config.apiKey],
  } as const;
  await assertCurrentCredentialBinding(pool, credentialInput);
  return new BraveSearchConnector(
    config,
    store,
    fetch,
    new DatabaseCredentialUseGuard(pool, credentialInput),
    new DatabaseAuthorityUseGuard(
      pool,
      config.approvalReceiptId,
      "SEARCH_PROVIDER_APPROVAL",
    ),
  );
}
