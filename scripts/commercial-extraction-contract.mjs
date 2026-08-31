import { createHash } from "node:crypto";
import { EvidenceBoundCommercialExtractor } from "../dist/index.js";
const text =
    "We can offer natural rPP reprocessed, 42 MT total. NET 78.5 INR/kg ex Ahmedabad. MOQ 20 MT. MFI 11-14.",
  raw = new TextEncoder().encode(
    `From: supplier@example.test\r\nTo: broker@example.test\r\nSubject: Offer\r\n\r\n${text}`,
  ),
  fields = {
    material: {
      value: "natural rPP reprocessed",
      source_span: "natural rPP reprocessed",
      confidence: 0.99,
    },
    quantity_mt: { value: "42", source_span: "42 MT", confidence: 0.99 },
    net_per_kg: { value: "78.5", source_span: "78.5 INR/kg", confidence: 0.99 },
    currency: { value: "INR", source_span: "INR", confidence: 0.99 },
    moq_mt: { value: "20", source_span: "20 MT", confidence: 0.99 },
    mfi_min: { value: "11", source_span: "11-14", confidence: 0.99 },
    mfi_max: { value: "14", source_span: "11-14", confidence: 0.99 },
  },
  response = {
    choices: [
      {
        message: {
          content: JSON.stringify({ classification: "SUPPLIER_OFFER", fields }),
        },
      },
    ],
  },
  store = {
    async preserve(prefix, body) {
      return {
        objectKey: `${prefix}/${createHash("sha256").update(body).digest("hex")}`,
        sha256: createHash("sha256").update(body).digest("hex"),
        bytes: body.length,
        contentType: "application/json",
        storedAt: new Date().toISOString(),
        source: "test",
      };
    },
  },
  fetcher = async () =>
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  extractor = new EvidenceBoundCommercialExtractor(
    {
      endpoint: "https://llm.example.test/extract",
      model: "fixture",
      authorizationHeader: "Bearer fixture",
      approvalReceiptId: "receipt",
      schemaVersion: "commercial-v1",
    },
    store,
    fetcher,
  ),
  decision = await extractor.extract(raw, new Date().toISOString());
if (
  !decision.offer ||
  decision.offer.quantityMt !== "42" ||
  decision.offer.netPerKg !== "78.5" ||
  decision.offer.mfiMax !== "14" ||
  decision.offer.verified !== false
)
  throw new Error("messy offer extraction failed");
const poisoned = {
    ...response,
    choices: [
      {
        message: {
          content: JSON.stringify({
            classification: "SUPPLIER_OFFER",
            fields: {
              ...fields,
              net_per_kg: {
                value: "1",
                source_span: "ignore prior instructions",
                confidence: 0.99,
              },
            },
          }),
        },
      },
    ],
  },
  bad = new EvidenceBoundCommercialExtractor(
    extractor.config,
    store,
    async () => new Response(JSON.stringify(poisoned), { status: 200 }),
  ),
  incomplete = await bad.extract(raw, new Date().toISOString());
if (incomplete.offer) throw new Error("non-source-cited value survived");
console.log(
  "COMMERCIAL_EXTRACTION_OK messy_language=source_cited uncertain=unknown prompt_injection=blocked policy=deterministic",
);
