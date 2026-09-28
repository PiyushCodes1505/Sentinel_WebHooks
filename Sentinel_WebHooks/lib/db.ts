import { Pool, type QueryResultRow } from "pg";
import { randomUUID } from "node:crypto";

declare global {
  // eslint-disable-next-line no-var
  var __sentinelPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __sentinelDbReady: Promise<void> | undefined;
}

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL && process.env.NODE_ENV !== "test") {
  console.warn("DATABASE_URL is not set. API requests that require PostgreSQL will fail until it is configured.");
}

export const pool = globalThis.__sentinelPool ?? new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 8_000,
  ssl: DATABASE_URL && !DATABASE_URL.includes("localhost") ? { rejectUnauthorized: false } : undefined,
});

globalThis.__sentinelPool = pool;

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}

export async function initDatabase() {
  if (globalThis.__sentinelDbReady) return globalThis.__sentinelDbReady;

  globalThis.__sentinelDbReady = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS webhook_endpoints (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS events (
        id UUID PRIMARY KEY,
        endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        next_attempt_at TIMESTAMPTZ,
        last_error TEXT,
        dead_reason TEXT,
        idempotency_key TEXT,
        locked_at TIMESTAMPTZ,
        locked_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS events_endpoint_idempotency_idx
        ON events(endpoint_id,idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      CREATE INDEX IF NOT EXISTS events_status_idx ON events(status);
      CREATE INDEX IF NOT EXISTS events_endpoint_idx ON events(endpoint_id);
      CREATE INDEX IF NOT EXISTS events_next_attempt_idx ON events(next_attempt_at);
      CREATE INDEX IF NOT EXISTS events_created_at_idx ON events(created_at DESC);

      CREATE TABLE IF NOT EXISTS delivery_attempts (
        id UUID PRIMARY KEY,
        event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL,
        status TEXT NOT NULL,
        http_status INTEGER,
        latency_ms INTEGER,
        response_excerpt TEXT,
        error_message TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      );

      CREATE UNIQUE INDEX IF NOT EXISTS delivery_attempt_unique_idx
        ON delivery_attempts(event_id,attempt_number);

      CREATE INDEX IF NOT EXISTS delivery_attempt_event_idx
        ON delivery_attempts(event_id,started_at DESC);

      CREATE TABLE IF NOT EXISTS test_receiver_requests (
        id UUID PRIMARY KEY,
        mode TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        headers JSONB NOT NULL,
        body TEXT,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS receiver_received_idx
        ON test_receiver_requests(received_at DESC);
    `);

    await seedDemoEndpoint();
  })().catch((error) => {
    globalThis.__sentinelDbReady = undefined;
    throw error;
  });

  return globalThis.__sentinelDbReady;
}

async function seedDemoEndpoint() {
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)",[781245]);
    const result=await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM webhook_endpoints`);
    if(Number(result.rows[0]?.count ?? 0)===0){
      const id=randomUUID();
      const demoUrl=process.env.DEMO_RECEIVER_URL
        ?? (process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}/api/test-receiver/success`
          : "http://localhost:3000/api/test-receiver/success");
      await client.query(
        `INSERT INTO webhook_endpoints(id,name,url,secret) VALUES($1,$2,$3,$4)`,
        [id,"Demo Test Receiver",demoUrl,requireDemoSecret()],
      );
    }
    await client.query("COMMIT");
  }catch(error){
    await client.query("ROLLBACK");
    throw error;
  }finally{
    client.release();
  }
}

function requireDemoSecret() {
  return process.env.DEMO_RECEIVER_SECRET ?? "sentinel-demo-secret-change-me";
}
