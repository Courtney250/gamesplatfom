import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured. Add an external PostgreSQL development connection through the protected secret settings.");
  }
  pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "duelke",
    ssl: /sslmode=(require|verify-ca|verify-full)/i.test(connectionString) ? { rejectUnauthorized: true } : undefined,
  });
  pool.on("error", (error) => {
    // Do not log connection strings, SQL parameters, or credentials.
    console.error(JSON.stringify({ level: "error", event: "postgres_idle_client_error", message: error.message }));
  });
  return pool;
}

export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve the original error */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}
