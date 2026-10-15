import "@testing-library/jest-dom/vitest";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV === "test" && databaseUrl && /prod|production/i.test(databaseUrl)) {
  throw new Error("Tests must never run against a production DATABASE_URL.");
}
if (process.env.RUN_POSTGRES_INTEGRATION === "true") {
  if (!databaseUrl) throw new Error("RUN_POSTGRES_INTEGRATION requires a local DATABASE_URL.");
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const localHost = !parsed.hostname || ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  const localSocket = Boolean(process.env.PGHOST?.startsWith("/"));
  if (databaseName !== "duelke_test" || (!localHost && !localSocket)) {
    throw new Error("PostgreSQL integration tests are restricted to a local database named duelke_test.");
  }
}
