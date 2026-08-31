import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { Pool as PgPool } from "pg";

export interface DatabaseConfig {
  readonly connectionString: string;
  readonly applicationName: string;
  readonly maxConnections: number;
  readonly ssl: "REQUIRE" | "DISABLE";
}
export interface InboxRecord {
  readonly provider: string;
  readonly externalEventId: string;
  readonly payloadDigest: string;
  readonly payloadObjectKey: string;
  readonly receivedAt: string;
  readonly signatureVerified: boolean;
}
export interface OutboxRecord {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
}

export function createDatabasePool(config: DatabaseConfig): Pool {
  if (
    !config.connectionString.startsWith("postgresql://") ||
    config.maxConnections < 1
  )
    throw new Error("database configuration invalid");
  return new PgPool({
    connectionString: config.connectionString,
    application_name: config.applicationName,
    max: config.maxConnections,
    ssl: config.ssl === "REQUIRE" ? { rejectUnauthorized: true } : false,
  });
}

export async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const value = await work(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function runMigrations(
  pool: Pool,
  migrationPaths: readonly string[],
): Promise<readonly string[]> {
  const client = await pool.connect();
  const { createHash } = await import("node:crypto"),
    applied: string[] = [];
  try {
    await client.query("select pg_advisory_lock(hashtext('sablestone:migrations'))");
    await client.query(
      "create table if not exists migration_checksums (version text primary key, sha256 text not null, verified_at timestamptz not null default now())",
    );
    for (const path of [...migrationPaths].sort()) {
      const sql = await readFile(path, "utf8"),
        name = basename(path),
        version = name.replace(/\.sql$/, ""),
        digest = createHash("sha256").update(sql).digest("hex");
      const checksum = await client.query<{ sha256: string }>(
        "select sha256 from migration_checksums where version=$1",
        [version],
      );
      if (checksum.rows[0]) {
        if (checksum.rows[0].sha256 !== digest)
          throw new Error(`migration drift: ${name}`);
        continue;
      }
      const ledgerExists = Boolean(
          (
            await client.query<{ table_name: string | null }>(
              "select to_regclass('public.schema_migrations')::text as table_name",
            )
          ).rows[0]?.table_name,
        ),
        appliedVersion = ledgerExists
          ? await client.query(
              "select 1 from schema_migrations where version=$1",
              [version],
            )
          : null;
      if (!appliedVersion?.rows[0]) await client.query(sql);
      await client.query(
        "insert into migration_checksums(version,sha256) values($1,$2)",
        [version, digest],
      );
      applied.push(name);
    }
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('sablestone:migrations'))").catch(() => undefined);
    client.release();
  }
  return Object.freeze(applied);
}

export class DurableInboxRepository {
  constructor(readonly pool: Pool) {}
  async insert(record: InboxRecord): Promise<"INSERTED" | "REPLAY"> {
    if (
      !record.signatureVerified ||
      !/^[0-9a-f]{64}$/.test(record.payloadDigest)
    )
      throw new Error("unverified inbox event");
    return inTransaction(this.pool, async (client) => {
      const result = await client.query<{ payload_digest: string }>(
        "select payload_digest from external_event_inbox where provider=$1 and external_event_id=$2 for update",
        [record.provider, record.externalEventId],
      );
      if (result.rows[0]) {
        if (result.rows[0].payload_digest !== record.payloadDigest)
          throw new Error("inbox replay conflict");
        return "REPLAY";
      }
      await client.query(
        "insert into external_event_inbox(provider,external_event_id,payload_digest,payload_object_key,received_at,signature_verified,processing_state) values($1,$2,$3,$4,$5,true,'PENDING')",
        [
          record.provider,
          record.externalEventId,
          record.payloadDigest,
          record.payloadObjectKey,
          record.receivedAt,
        ],
      );
      return "INSERTED";
    });
  }
  async claim(limit: number): Promise<readonly QueryResultRow[]> {
    if (limit < 1 || limit > 100) throw new Error("inbox claim limit invalid");
    return inTransaction(
      this.pool,
      async (client) =>
        (
          await client.query(
            "with claimed as (select provider,external_event_id from external_event_inbox where processing_state='PENDING' or (processing_state='PROCESSING' and claimed_at<now()-interval '5 minutes') order by received_at for update skip locked limit $1) update external_event_inbox i set processing_state='PROCESSING',claimed_at=now(),attempts=attempts+1 from claimed where i.provider=claimed.provider and i.external_event_id=claimed.external_event_id returning i.*",
            [limit],
          )
        ).rows,
    );
  }
  async complete(provider:string,externalEventId:string,state:"PROCESSED"|"REJECTED"):Promise<void>{const result=await this.pool.query("update external_event_inbox set processing_state=$3,processed_at=now(),claimed_at=null where provider=$1 and external_event_id=$2 and processing_state='PROCESSING'",[provider,externalEventId,state]);if((result.rowCount??0)!==1)throw new Error("inbox completion conflict")}
  async fail(provider:string,externalEventId:string,errorCode:string):Promise<void>{const result=await this.pool.query("update external_event_inbox set processing_state=case when attempts>=5 then 'REJECTED' else 'PENDING' end,processed_at=case when attempts>=5 then now() else null end,claimed_at=null,last_error_code=$3 where provider=$1 and external_event_id=$2 and processing_state='PROCESSING'",[provider,externalEventId,errorCode.slice(0,100)]);if((result.rowCount??0)!==1)throw new Error("inbox failure transition conflict")}
}

export class TransactionalOutboxRepository {
  constructor(readonly pool: Pool) {}
  async append(client: PoolClient, event: OutboxRecord): Promise<void> {
    await client.query(
      "insert into transactional_outbox(event_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key,state) values($1,$2,$3,$4,$5,$6,'PENDING') on conflict(idempotency_key) do nothing",
      [
        event.id,
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        event.payload,
        event.idempotencyKey,
      ],
    );
  }
  async claim(limit: number): Promise<readonly QueryResultRow[]> {
    return inTransaction(
      this.pool,
      async (client) =>
        (
          await client.query(
            "select * from transactional_outbox where state='PENDING' order by created_at for update skip locked limit $1",
            [limit],
          )
        ).rows,
    );
  }
}

export class PostgresHistoryCursorRepository {
  constructor(readonly pool: Pool, readonly connector = "GMAIL") {}
  async get(scope: string): Promise<bigint> {
    const result = await this.pool.query<{ cursor: string }>(
      "select cursor from connector_cursors where connector=$1 and scope=$2",
      [this.connector, scope],
    );
    return BigInt(result.rows[0]?.cursor ?? "0");
  }
  async advance(scope: string, expected: bigint, next: bigint): Promise<boolean> {
    if (next < expected) throw new Error("cursor regression");
    const result = await this.pool.query(
      "insert into connector_cursors(connector,scope,cursor,version) values($1,$2,$3,1) on conflict(connector,scope) do update set cursor=excluded.cursor,version=connector_cursors.version+1,updated_at=now() where connector_cursors.cursor=$4",
      [this.connector, scope, next.toString(), expected.toString()],
    );
    return (result.rowCount ?? 0) === 1;
  }
}

export class OutboxDispatcher {
  constructor(
    readonly pool: Pool,
    readonly publish: (event: QueryResultRow) => Promise<void>,
  ) {}
  async dispatchBatch(limit = 50): Promise<number> {
    if (limit < 1 || limit > 100) throw new Error("outbox batch invalid");
    const client = await this.pool.connect();
    let count = 0;
    try {
      await client.query("begin");
      const rows = (
        await client.query(
          "with claimed as (select event_id from transactional_outbox where state='PENDING' or (state='PROCESSING' and claimed_at<now()-interval '5 minutes') order by created_at for update skip locked limit $1) update transactional_outbox o set state='PROCESSING',claimed_at=now(),attempts=attempts+1 from claimed where o.event_id=claimed.event_id returning o.*",
          [limit],
        )
      ).rows;
      await client.query("commit");
      for (const row of rows) {
        try {
          await this.publish(row);
          await this.pool.query(
            "update transactional_outbox set state='PUBLISHED',published_at=now(),claimed_at=null where event_id=$1 and state='PROCESSING'",
            [row.event_id],
          );
          count++;
        } catch {
          await this.pool.query(
            "update transactional_outbox set state=case when attempts>=10 then 'FAILED' else 'PENDING' end,claimed_at=null where event_id=$1 and state='PROCESSING'",
            [row.event_id],
          );
        }
      }
      return count;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
