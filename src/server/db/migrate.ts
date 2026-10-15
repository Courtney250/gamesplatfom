import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getPool, closePool, withTransaction } from "./pool.js";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

async function migrate(): Promise<void> {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(migrationsDir)).filter((f) => /^\d+_[a-z0-9_]+\.sql$/.test(f)).sort();
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const prior = await pool.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE version=$1", [file]);
    if (prior.rowCount) {
      if (prior.rows[0]?.checksum !== checksum) throw new Error(`Applied migration ${file} differs from its recorded checksum; add a new migration instead of editing it.`);
      continue;
    }
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)", [file, checksum]);
    });
    console.info(JSON.stringify({ event: "migration_applied", version: file }));
  }
  console.info(JSON.stringify({ event: "migrations_complete", count: files.length }));
}

migrate().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "migration_failed", message: error instanceof Error ? error.message : "unknown error" }));
  process.exitCode = 1;
}).finally(() => closePool());
