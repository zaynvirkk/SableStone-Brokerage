import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import { fileTypeFromBuffer } from "file-type";
import type { ReceiptWriter } from "./discovery_http.js";
import type { CredentialUseGuard } from "../runtime/production_credentials.js";
import type { AuthorityUseGuard } from "../runtime/authority_receipts.js";
import { simpleParser } from "mailparser";
export type DocumentKind =
  | "COA"
  | "TDS"
  | "REGISTRATION"
  | "GST_COMPANY"
  | "BANK_DETAILS"
  | "SAMPLE_INSPECTION"
  | "UNKNOWN";
export type DocumentFactState =
  | "SOURCE_STATED"
  | "VERIFIED"
  | "UNKNOWN"
  | "EXPIRED"
  | "CONFLICTING";
export interface ExtractedDocumentFact {
  readonly field: string;
  readonly value: string | null;
  readonly unit: string | null;
  readonly confidence: string;
  readonly state: DocumentFactState;
  readonly sourceReceiptId: string;
}
export interface DocumentExtraction {
  readonly kind: DocumentKind;
  readonly facts: readonly ExtractedDocumentFact[];
  readonly extractor: string;
  readonly modelVersion: string;
}
export interface MalwareScanner {
  scan(bytes: Uint8Array): Promise<"CLEAN" | "INFECTED" | "UNKNOWN">;
}
export interface StructuredDocumentExtractor {
  extract(input: {
    bytes: Uint8Array;
    mediaType: string;
    receiptId: string;
  }): Promise<DocumentExtraction>;
}
export interface IngestedDocument {
  readonly documentId: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly mediaType: string;
  readonly malwareState: "CLEAN";
  readonly extraction: DocumentExtraction;
}
export class DocumentIngestionPipeline {
  constructor(
    readonly store: ReceiptWriter,
    readonly scanner: MalwareScanner,
    readonly extractor: StructuredDocumentExtractor,
  ) {}
  async ingest(
    fileName: string,
    bytes: Uint8Array,
    declaredMediaType: string,
    source: string,
  ): Promise<IngestedDocument> {
    if (bytes.byteLength < 1 || bytes.byteLength > 25_000_000)
      throw new Error("document size rejected");
    const detected = await fileTypeFromBuffer(bytes),
      mediaType = detected?.mime ?? declaredMediaType;
    if (
      !["application/pdf", "image/jpeg", "image/png", "image/tiff"].includes(
        mediaType,
      )
    )
      throw new Error("document media type rejected");
    const receipt = await this.store.preserve(
        "documents/raw",
        bytes,
        mediaType,
        source,
      ),
      malwareState = await this.scanner.scan(bytes);
    if (malwareState !== "CLEAN")
      throw new Error(`document malware state ${malwareState}`);
    const extraction = await this.extractor.extract({
      bytes,
      mediaType,
      receiptId: receipt.objectKey,
    });
    for (const fact of extraction.facts) {
      if (
        fact.sourceReceiptId !== receipt.objectKey ||
        ![
          "SOURCE_STATED",
          "VERIFIED",
          "UNKNOWN",
          "EXPIRED",
          "CONFLICTING",
        ].includes(fact.state)
      )
        throw new Error("extracted fact provenance invalid");
      if (fact.state === "VERIFIED" && fact.confidence !== "1.000000")
        throw new Error("extraction alone cannot verify fact");
    }
    return Object.freeze({
      documentId: createHash("sha256")
        .update(`${fileName}:${receipt.sha256}`)
        .digest("hex")
        .slice(0, 32),
      objectKey: receipt.objectKey,
      sha256: receipt.sha256,
      bytes: receipt.bytes,
      mediaType,
      malwareState: "CLEAN",
      extraction: Object.freeze({
        ...extraction,
        facts: Object.freeze([...extraction.facts]),
      }),
    });
  }
}
export class ClamAvTcpScanner implements MalwareScanner {
  constructor(
    readonly host: string,
    readonly port: number,
    readonly timeoutMs = 10_000,
  ) {}
  scan(bytes: Uint8Array): Promise<"CLEAN" | "INFECTED" | "UNKNOWN"> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port }),
        chunks: Buffer[] = [];
      socket.setTimeout(this.timeoutMs);
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < bytes.length; offset += 8192) {
          const chunk = Buffer.from(bytes.subarray(offset, offset + 8192)),
            length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
      socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      socket.on("timeout", () =>
        socket.destroy(new Error("malware scan timeout")),
      );
      socket.on("error", reject);
      socket.on("close", () => {
        const result = Buffer.concat(chunks).toString("utf8");
        if (result.includes("FOUND")) resolve("INFECTED");
        else if (result.includes("OK")) resolve("CLEAN");
        else resolve("UNKNOWN");
      });
    });
  }
}
export interface DocumentExtractorHttpConfig {
  readonly provider: string;
  readonly baseUrl: string;
  readonly extractionPath: string;
  readonly authorizationHeader: string;
  readonly approvalReceiptId: string;
  readonly validUntil: string;
  readonly modelVersion: string;
}
export class ProductionDocumentHttpExtractor implements StructuredDocumentExtractor {
  constructor(
    readonly config: DocumentExtractorHttpConfig,
    readonly store: ReceiptWriter,
    readonly fetcher: typeof fetch = fetch,
    readonly credentialGuard?: CredentialUseGuard,
    readonly authorityGuard?: AuthorityUseGuard,
  ) {
    if (
      !config.baseUrl.startsWith("https://") ||
      !config.authorizationHeader ||
      !config.approvalReceiptId ||
      Date.parse(config.validUntil) <= Date.now()
    )
      throw new Error("document extractor unavailable");
  }
  async extract(input: {
    bytes: Uint8Array;
    mediaType: string;
    receiptId: string;
  }): Promise<DocumentExtraction> {
    await this.authorityGuard?.assertCurrent();
    await this.credentialGuard?.assertCurrent();
    const url = new URL(this.config.extractionPath, this.config.baseUrl),
      payload = JSON.stringify({
        contentBase64: Buffer.from(input.bytes).toString("base64"),
        mediaType: input.mediaType,
        sourceReceiptId: input.receiptId,
      }),
      request = await this.store.preserve(
        `documents/${this.config.provider}/request`,
        new TextEncoder().encode(payload),
        "application/json",
        url.toString(),
      ),
      response = await this.fetcher(url, {
        method: "POST",
        headers: {
          authorization: this.config.authorizationHeader,
          "content-type": "application/json",
        },
        body: payload,
        signal: AbortSignal.timeout(60_000),
      }),
      bytes = new Uint8Array(await response.arrayBuffer()),
      receipt = await this.store.preserve(
        `documents/${this.config.provider}/response`,
        bytes,
        response.headers.get("content-type") ?? "application/json",
        url.toString(),
      );
    if (!response.ok)
      throw new Error(
        `document extractor HTTP ${response.status}; request=${request.objectKey}; response=${receipt.objectKey}`,
      );
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as {
      kind?: DocumentKind;
      facts?: {
        field?: string;
        value?: string | null;
        unit?: string | null;
        confidence?: string;
      }[];
    };
    if (!decoded.kind || !Array.isArray(decoded.facts))
      throw new Error("document extraction response invalid");
    const facts = decoded.facts.map((fact) => {
      if (
        !fact.field ||
        !/^0(?:\.\d{1,6})?$|^1(?:\.0{1,6})?$/.test(fact.confidence ?? "")
      )
        throw new Error("document extraction fact invalid");
      return Object.freeze({
        field: fact.field,
        value: fact.value ?? null,
        unit: fact.unit ?? null,
        confidence: fact.confidence!,
        state: "SOURCE_STATED" as const,
        sourceReceiptId: input.receiptId,
      });
    });
    return Object.freeze({
      kind: decoded.kind,
      facts: Object.freeze(facts),
      extractor: this.config.provider,
      modelVersion: this.config.modelVersion,
    });
  }
}
export function reconcileFacts(
  primary: readonly ExtractedDocumentFact[],
  secondary: readonly ExtractedDocumentFact[],
): readonly ExtractedDocumentFact[] {
  const byField = new Map(secondary.map((fact) => [fact.field, fact]));
  return Object.freeze(
    primary.map((fact) => {
      const other = byField.get(fact.field);
      if (!other || fact.value === null || other.value === null) return fact;
      if (fact.value.trim().toLowerCase() !== other.value.trim().toLowerCase())
        return Object.freeze({ ...fact, state: "CONFLICTING" as const });
      return fact;
    }),
  );
}
export async function ingestMimeAttachments(
  rawMime: Uint8Array,
  pipeline: DocumentIngestionPipeline,
  sourceMessageId: string,
): Promise<readonly IngestedDocument[]> {
  const parsed = await simpleParser(Buffer.from(rawMime));
  if (parsed.attachments.length > 25)
    throw new Error("email attachment count rejected");
  let total = 0;
  const documents: IngestedDocument[] = [];
  for (const attachment of parsed.attachments) {
    total += attachment.size;
    if (total > 50_000_000)
      throw new Error("email attachment aggregate rejected");
    documents.push(
      await pipeline.ingest(
        attachment.filename ?? `attachment-${documents.length + 1}`,
        attachment.content,
        attachment.contentType,
        `gmail:${sourceMessageId}`,
      ),
    );
  }
  return Object.freeze(documents);
}

export interface DocumentVerifierHttpConfig {
  readonly provider: string;
  readonly baseUrl: string;
  readonly verificationPath: string;
  readonly authorizationHeader: string;
  readonly approvalReceiptId: string;
  readonly validUntil: string;
  readonly policyVersion: string;
}
export interface VerifiedDocumentCheck {
  readonly checkType: string;
  readonly state: "VERIFIED" | "UNVERIFIED" | "EXPIRED" | "MISMATCH";
  readonly validUntil: string | null;
}
export interface DocumentVerificationResult {
  readonly provider: string;
  readonly externalReference: string;
  readonly documentKind: DocumentKind;
  readonly checks: readonly VerifiedDocumentCheck[];
  readonly requestObjectKey: string;
  readonly responseObjectKey: string;
  readonly responseSha256: string;
}
export class ProductionDocumentVerifier {
  constructor(
    readonly config: DocumentVerifierHttpConfig,
    readonly store: ReceiptWriter,
    readonly fetcher: typeof fetch = fetch,
    readonly credentialGuard?: CredentialUseGuard,
    readonly authorityGuard?: AuthorityUseGuard,
  ) {
    if (
      !config.baseUrl.startsWith("https://") ||
      !config.authorizationHeader ||
      !config.approvalReceiptId ||
      !config.policyVersion ||
      Date.parse(config.validUntil) <= Date.now()
    )
      throw new Error("document verifier unavailable");
  }
  async verify(input: {
    bytes: Uint8Array;
    sha256: string;
    extraction: DocumentExtraction;
    documentId: string;
  }): Promise<DocumentVerificationResult> {
    await this.authorityGuard?.assertCurrent();
    await this.credentialGuard?.assertCurrent();
    if (Date.parse(this.config.validUntil) <= Date.now())
      throw new Error("document verifier approval expired");
    const url = new URL(this.config.verificationPath, this.config.baseUrl),
      payload = JSON.stringify({
        documentId: input.documentId,
        sha256: input.sha256,
        contentBase64: Buffer.from(input.bytes).toString("base64"),
        sourceExtraction: input.extraction,
      }),
      request = await this.store.preserve(
        `documents/${this.config.provider}/verification-request`,
        new TextEncoder().encode(payload),
        "application/json",
        url.toString(),
      ),
      response = await this.fetcher(url, {
        method: "POST",
        headers: {
          authorization: this.config.authorizationHeader,
          "content-type": "application/json",
        },
        body: payload,
        signal: AbortSignal.timeout(60_000),
      }),
      bytes = new Uint8Array(await response.arrayBuffer()),
      receipt = await this.store.preserve(
        `documents/${this.config.provider}/verification-response`,
        bytes,
        response.headers.get("content-type") ?? "application/json",
        url.toString(),
      );
    if (!response.ok)
      throw new Error(
        `document verifier HTTP ${response.status}; request=${request.objectKey}; response=${receipt.objectKey}`,
      );
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as {
      externalReference?: string;
      documentKind?: DocumentKind;
      independentlyVerified?: boolean;
      checks?: VerifiedDocumentCheck[];
    };
    if (
      decoded.independentlyVerified !== true ||
      !decoded.externalReference?.trim() ||
      !decoded.documentKind ||
      decoded.documentKind !== input.extraction.kind ||
      !Array.isArray(decoded.checks) ||
      !decoded.checks.length
    )
      throw new Error("document verifier response incomplete");
    const checks = decoded.checks.map((check) => {
      if (
        !check.checkType?.trim() ||
        !["VERIFIED", "UNVERIFIED", "EXPIRED", "MISMATCH"].includes(
          check.state,
        ) ||
        (check.validUntil !== null &&
          Number.isNaN(Date.parse(check.validUntil)))
      )
        throw new Error("document verifier check invalid");
      return Object.freeze({ ...check });
    });
    return Object.freeze({
      provider: this.config.provider,
      externalReference: decoded.externalReference,
      documentKind: decoded.documentKind,
      checks: Object.freeze(checks),
      requestObjectKey: request.objectKey,
      responseObjectKey: receipt.objectKey,
      responseSha256: receipt.sha256,
    });
  }
}
