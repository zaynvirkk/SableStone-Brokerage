import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Upload } from "@aws-sdk/lib-storage";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { ImmutableEvidenceStore } from "./object_store.js";
const execFileAsync = promisify(execFile);
async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export interface DatabaseBackupReceipt {
  readonly objectKey: string;
  readonly encryptedSha256: string;
  readonly bytes: number;
  readonly algorithm: "aes-256-gcm";
  readonly ivBase64: string;
  readonly authTagBase64: string;
  readonly createdAt: string;
  readonly sourceReleaseDigest: string;
}
export async function createEncryptedDatabaseBackup(input: {
  databaseUrl: string;
  encryptionKey: Uint8Array;
  store: ImmutableEvidenceStore;
  releaseDigest: string;
  now?: string;
}): Promise<DatabaseBackupReceipt> {
  if (input.encryptionKey.byteLength !== 32)
    throw new Error("backup encryption key must be 256 bit");
  const directory = await mkdtemp(join(tmpdir(), "sablestone-backup-")),
    dump = join(directory, "database.dump"),
    encrypted = join(directory, "database.dump.enc"),
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", input.encryptionKey, iv),
    createdAt = input.now ?? new Date().toISOString();
  try {
    await execFileAsync(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-acl", "--file", dump],
      {
        env: { ...process.env, PGDATABASE: input.databaseUrl },
        timeout: 30 * 60_000,
        maxBuffer: 1024 * 1024,
      },
    );
    await pipeline(
      createReadStream(dump),
      cipher,
      createWriteStream(encrypted, { mode: 0o600 }),
    );
    const authTag = cipher.getAuthTag(),
      digest = await hashFile(encrypted),
      size = (await stat(encrypted)).size,
      objectKey = `backups/postgres/${createdAt.replace(/[:.]/g, "-")}-${digest}.dump.enc`;
    await new Upload({
      client: input.store.client,
      params: {
        Bucket: input.store.config.bucket,
        Key: objectKey,
        Body: createReadStream(encrypted),
        ContentType: "application/octet-stream",
        ServerSideEncryption: "AES256",
        Metadata: {
          sha256: digest,
          algorithm: "aes-256-gcm",
          iv: iv.toString("base64"),
          auth_tag: authTag.toString("base64"),
          release_digest: input.releaseDigest,
        },
      },
    }).done();
    return Object.freeze({
      objectKey,
      encryptedSha256: digest,
      bytes: size,
      algorithm: "aes-256-gcm",
      ivBase64: iv.toString("base64"),
      authTagBase64: authTag.toString("base64"),
      createdAt,
      sourceReleaseDigest: input.releaseDigest,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export async function restoreDatabaseBackup(input: {
  receipt: DatabaseBackupReceipt;
  encryptionKey: Uint8Array;
  store: ImmutableEvidenceStore;
  isolatedDatabaseUrl: string;
}): Promise<void> {
  if (
    input.encryptionKey.byteLength !== 32 ||
    input.receipt.algorithm !== "aes-256-gcm"
  )
    throw new Error("restore key or algorithm invalid");
  const directory = await mkdtemp(join(tmpdir(), "sablestone-restore-")),
    encrypted = join(directory, "database.dump.enc"),
    dump = join(directory, "database.dump");
  try {
    const response = await input.store.client.send(
      new GetObjectCommand({
        Bucket: input.store.config.bucket,
        Key: input.receipt.objectKey,
      }),
    );
    if (!response.Body) throw new Error("backup object body missing");
    await pipeline(
      response.Body as NodeJS.ReadableStream,
      createWriteStream(encrypted, { mode: 0o600 }),
    );
    if ((await hashFile(encrypted)) !== input.receipt.encryptedSha256)
      throw new Error("backup object digest invalid");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      input.encryptionKey,
      Buffer.from(input.receipt.ivBase64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(input.receipt.authTagBase64, "base64"));
    await pipeline(
      createReadStream(encrypted),
      decipher,
      createWriteStream(dump, { mode: 0o600 }),
    );
    await execFileAsync(
      "pg_restore",
      [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-acl",
        "--dbname",
        input.isolatedDatabaseUrl,
        dump,
      ],
      { timeout: 30 * 60_000, maxBuffer: 1024 * 1024 },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
