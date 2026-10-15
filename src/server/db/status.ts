import { getPool, closePool } from "./pool.js";

async function status(): Promise<void> {
  const pool = getPool();
  const result = await pool.query<{ version: string; applied_at: Date }>(
    "SELECT version, applied_at FROM schema_migrations ORDER BY version",
  );
  for (const row of result.rows) console.info(`${row.version}\t${row.applied_at.toISOString()}`);
  console.info(`Applied migrations: ${result.rowCount ?? 0}`);
}

status().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "migration_status_failed", message: error instanceof Error ? error.message : "unknown error" }));
  process.exitCode = 1;
}).finally(() => closePool());
