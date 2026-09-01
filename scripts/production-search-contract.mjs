import { createHash } from "node:crypto";
import { BraveSearchConnector } from "../dist/index.js";

const body = JSON.stringify({
  web: {
    results: [
      {
        url: "https://buyer.example/rigid-packaging",
        title: "Example Packaging",
        description: "Rigid packaging producer seeking recycled PP (rPP)",
      },
    ],
  },
});
let authorityCurrent = true,
  credentialCurrent = true,
  fetches = 0,
  writes = 0;
const connector = new BraveSearchConnector(
  {
    provider: "BRAVE",
    state: "APPROVED",
    apiKey: "contract-only-key",
    expiresAt: "2099-01-01T00:00:00.000Z",
    maximumResults: 5,
    approvalReceiptId: "search-approval",
  },
  {
    async preserve(prefix, bytes, contentType, source, storedAt) {
      writes += 1;
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      return {
        objectKey: `${prefix}/${sha256}`,
        sha256,
        bytes: bytes.byteLength,
        contentType,
        source,
        storedAt,
      };
    },
  },
  async (_url, init) => {
    fetches += 1;
    if (
      new Headers(init.headers).get("X-Subscription-Token") !==
      "contract-only-key"
    )
      throw new Error("credential not used");
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
  {
    async assertCurrent() {
      if (!credentialCurrent) throw new Error("credential revoked");
      return {
        id: "binding",
        verifiedAt: "2026-01-01",
        validUntil: "2099-01-01",
      };
    },
  },
  {
    async assertCurrent() {
      if (!authorityCurrent) throw new Error("authority expired");
    },
  },
);

const results = await connector.search("rPP rigid packaging India");
if (results.length !== 1 || writes !== 1 || fetches !== 1)
  throw new Error("approved search did not produce preserved evidence");
if (!/search\/brave\/[0-9a-f]{64}$/.test(results[0].receiptId))
  throw new Error("search receipt is not content addressed");

authorityCurrent = false;
await connector.search("must fail before network").then(
  () => {
    throw new Error("expired search authority accepted");
  },
  () => undefined,
);
if (fetches !== 1) throw new Error("authority failure reached network");

authorityCurrent = true;
credentialCurrent = false;
await connector.search("must fail before network").then(
  () => {
    throw new Error("revoked search credential accepted");
  },
  () => undefined,
);
if (fetches !== 1) throw new Error("credential failure reached network");

console.log(
  "PRODUCTION_SEARCH_OK evidence=preserved authority=per_use credential=per_use fail_closed=true",
);
