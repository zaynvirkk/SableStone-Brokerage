import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { createDatabasePool, type DatabaseConfig } from "./database.js";
import {
  ImmutableEvidenceStore,
  type EvidenceStoreConfig,
} from "./object_store.js";
import { createRedis, type RedisRuntimeConfig } from "./redis.js";
import {
  verifyProductionActivation,
  type ProductionActivationPayload,
  type SignedProductionActivation,
} from "./activation.js";
export interface ProductionRuntime {
  readonly activation: Readonly<ProductionActivationPayload>;
  readonly pool: Pool;
  readonly redis: Redis;
  readonly evidence: ImmutableEvidenceStore;
  readonly releaseDigest: string;
}
function required(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string {
  const value = env[key];
  if (!value?.trim()) throw new Error(`required secret/config missing: ${key}`);
  return value;
}
export async function bootstrapProduction(
  env: Readonly<Record<string, string | undefined>>,
  now = new Date().toISOString(),
): Promise<ProductionRuntime> {
  const releaseDigest = required(env, "SABLESTONE_RELEASE_DIGEST"),
    activationPath = required(env, "SABLESTONE_ACTIVATION_PATH"),
    trustedKeyDigest = required(env, "SABLESTONE_ACTIVATION_KEY_SHA256"),
    signed = JSON.parse(
      await readFile(activationPath, "utf8"),
    ) as SignedProductionActivation,
    activation = verifyProductionActivation(
      signed,
      releaseDigest,
      now,
      trustedKeyDigest,
    ),
    database: DatabaseConfig = {
      connectionString: required(env, "SABLESTONE_DATABASE_URL"),
      applicationName: "sablestone-production",
      maxConnections: Number(env["SABLESTONE_DATABASE_POOL_MAX"] ?? "20"),
      ssl: env["SABLESTONE_DATABASE_SSL"] === "DISABLE" ? "DISABLE" : "REQUIRE",
    },
    objectStore: EvidenceStoreConfig = {
      endpoint: required(env, "SABLESTONE_OBJECT_STORAGE_ENDPOINT"),
      region: env["SABLESTONE_OBJECT_STORAGE_REGION"] ?? "ap-south-1",
      bucket: required(env, "SABLESTONE_OBJECT_STORAGE_BUCKET"),
      accessKeyId: required(env, "SABLESTONE_OBJECT_STORAGE_ACCESS_KEY"),
      secretAccessKey: required(env, "SABLESTONE_OBJECT_STORAGE_SECRET_KEY"),
      forcePathStyle: env["SABLESTONE_OBJECT_STORAGE_PATH_STYLE"] === "true",
    },
    redisConfig: RedisRuntimeConfig = {
      url: required(env, "SABLESTONE_REDIS_URL"),
      keyPrefix: "sablestone:",
      connectTimeoutMs: 5000,
    };
  const pool = createDatabasePool(database),
    redis = createRedis(redisConfig),
    evidence = new ImmutableEvidenceStore(objectStore);
  try {
    await pool.query("select 1");
    if (activation.capabilities.some((capability) => capability !== "DEPLOY"))
      await assertActivationReceiptBindings(
        pool,
        activation,
        releaseDigest,
        now,
      );
    await redis.connect();
    await evidence.client.config.credentials();
  } catch (error) {
    await pool.end();
    redis.disconnect();
    throw error;
  }
  return Object.freeze({ activation, pool, redis, evidence, releaseDigest });
}
async function assertActivationReceiptBindings(
  pool: Pool,
  activation: Readonly<ProductionActivationPayload>,
  releaseDigest: string,
  now: string,
): Promise<void> {
  const requiredBindings: Array<readonly [string | null, string]> = [
    [activation.operatorAuthorizationReceiptId, "OPERATOR_AUTHORIZATION"],
    [activation.entityReceiptId, "ENTITY"],
    [activation.legalReceiptId, "LEGAL"],
    [activation.taxReceiptId, "TAX"],
    [activation.privacyReceiptId, "PRIVACY"],
    [activation.deploymentReceiptId, "DEPLOYMENT"],
  ];
  for (const [receiptId, purpose] of requiredBindings) {
    if (!receiptId)
      throw new Error(`activation ${purpose.toLowerCase()} receipt missing`);
    let result;
    try {
      result = await pool.query(
        "select 1 from activation_receipt_bindings b join authority_receipts a on a.receipt_id=b.receipt_id where b.receipt_id=$1 and b.purpose=$2 and b.release_digest=$3 and b.bound_at<=$4 and b.valid_until>$4 and a.effective_at<=$4 and a.expires_at>$4",
        [receiptId, purpose, releaseDigest, now],
      );
    } catch {
      throw new Error("activation receipt registry unavailable");
    }
    if (!result.rowCount)
      throw new Error(
        `activation ${purpose.toLowerCase()} receipt not current or release-bound`,
      );
  }
}
