export type CapabilityState =
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "UNDER_REVIEW"
  | "DEGRADED"
  | "REVOKED";

export interface RuntimeConfig {
  readonly liveTrading: false;
  readonly liveOutreach: false;
  readonly liveSettlement: false;
  readonly productionProviders: false;
  readonly databaseUrl: string;
  readonly temporalAddress: string;
  readonly objectStorageEndpoint: string;
  readonly redisUrl: string;
}

/**
 * Production configuration is intentionally not environment-derived yet.
 * SLB-33+ owns the separately authorized activation path. No value accepted by
 * this automatic build can turn a live capability on.
 */
export function loadBuildConfig(env: Readonly<Record<string, string | undefined>>): RuntimeConfig {
  return Object.freeze({
    liveTrading: false,
    liveOutreach: false,
    liveSettlement: false,
    productionProviders: false,
    databaseUrl: env["SABLESTONE_DATABASE_URL"] ?? "postgresql://sablestone:sablestone@127.0.0.1:54329/sablestone",
    temporalAddress: env["SABLESTONE_TEMPORAL_ADDRESS"] ?? "127.0.0.1:7233",
    objectStorageEndpoint: env["SABLESTONE_OBJECT_STORAGE_ENDPOINT"] ?? "http://127.0.0.1:9000",
    redisUrl: env["SABLESTONE_REDIS_URL"] ?? "redis://127.0.0.1:6389",
  });
}

export function assertOffline(config: RuntimeConfig): void {
  if (config.liveTrading || config.liveOutreach || config.liveSettlement || config.productionProviders) {
    throw new Error("automatic build cannot enable live capabilities");
  }
}
