// Connected-service prerequisite, not a full journey or SH-00 completion proof.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function localEndpoint(value, name, protocols) {
  if (!value) throw new Error(`${name} required`);
  const url = new URL(value);
  if (!protocols.includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error(`${name} must use an explicit loopback address`);
  return value;
}

export function readHarnessConfig(env) {
  if (env.SABLESTONE_DISPOSABLE_TEST_SERVICES !== 'true')
    throw new Error('explicit disposable test service acknowledgement required');
  for (const key of ['LIVE_TRADING', 'LIVE_OUTREACH', 'LIVE_SETTLEMENT', 'PRODUCTION_PROVIDERS'])
    if (env[key] && env[key] !== 'false') throw new Error(`${key} forbidden in launch tests`);
  return {
    database: localEndpoint(env.LAUNCH_TEST_DATABASE_URL, 'database', ['postgresql:']),
    redis: localEndpoint(env.LAUNCH_TEST_REDIS_URL, 'redis', ['redis:']),
    temporal: new URL(localEndpoint(env.LAUNCH_TEST_TEMPORAL_URL, 'temporal', ['http:'])).host,
    objectEndpoint: localEndpoint(env.LAUNCH_TEST_S3_URL, 'object storage', ['http:']),
    bucket: required(env.LAUNCH_TEST_S3_BUCKET, 'test bucket'),
    accessKeyId: required(env.LAUNCH_TEST_S3_ACCESS_KEY, 'test access key'),
    secretAccessKey: required(env.LAUNCH_TEST_S3_SECRET_KEY, 'test secret key'),
  };
}

function required(value, name) {
  if (!value?.trim()) throw new Error(`${name} required`);
  return value;
}

export async function probeServices(config) {
  const [{ createDatabasePool }, { createRedis }, { ImmutableEvidenceStore }, { Connection }] = await Promise.all([
    import('../../../dist/runtime/database.js'),
    import('../../../dist/runtime/redis.js'),
    import('../../../dist/runtime/object_store.js'),
    import('@temporalio/client'),
  ]);
  const pool = createDatabasePool({ connectionString: config.database, applicationName: 'sablestone-launch-test', maxConnections: 2, ssl: 'DISABLE' });
  const redis = createRedis({ url: config.redis, keyPrefix: 'sablestone-launch-test:', connectTimeoutMs: 2000 });
  redis.on('error', () => {});
  const store = new ImmutableEvidenceStore({ endpoint: config.objectEndpoint, region: 'us-east-1', bucket: config.bucket, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, forcePathStyle: true, requireObjectLock: true });
  let temporal;
  try {
    const database = await pool.query('select version() as version');
    await redis.connect();
    if (await redis.ping() !== 'PONG') throw new Error('Redis health failed');
    temporal = await Connection.connect({ address: config.temporal, connectTimeout: '3 seconds' });
    await temporal.workflowService.describeNamespace({ namespace: 'default' });
    await store.assertRetentionPolicy();
    return { database: database.rows[0].version, redis: 'PONG', temporal: 'default namespace reachable', objectStorage: 'COMPLIANCE retention verified', journeyVerified: false };
  } finally {
    await temporal?.close();
    redis.disconnect();
    store.client.destroy();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await probeServices(readHarnessConfig(process.env))));
  } catch (error) {
    // No credential-bearing connection URL is printed.
    console.error(`Connected service prerequisite failed (${error.constructor.name}); no completion evidence emitted.`);
    process.exitCode = 1;
  }
}
