import "express-async-errors";
import express, { type Express } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sessionMiddleware, requireCsrf } from "./auth/sessions.js";
import { createAuthRouter } from "./auth/routes.js";
import { sendEmail, type EmailSender } from "./auth/email.js";
import { createGamesRouter } from "./games/routes.js";
import { walletRouter } from "./ledger/routes.js";
import { paymentRouter } from "./payments/routes.js";
import { userRouter } from "./user/routes.js";
import { adminRouter } from "./admin/routes.js";
import { getPool } from "./db/pool.js";
import { isRealMoneyEnabled } from "../shared/config.js";

export type AppDependencies = {
  emailSender?: EmailSender;
  broadcast?: (matchId: string, event: string, payload: unknown) => void;
  configureFrontend?: (app: Express) => void;
};
const clientDist = path.resolve(process.cwd(), "dist/public");
const exactClientRoutes = new Set([
  "/", "/games", "/how-it-works", "/faq", "/support", "/terms", "/privacy", "/wallet-policy",
  "/fair-play", "/responsible-play", "/login", "/register", "/reset-password", "/verify-email",
  "/play", "/dashboard", "/account/security", "/account/verification", "/admin", "/admin/users",
  "/admin/matches", "/admin/support", "/admin/verification", "/admin/finance", "/admin/reconciliation",
  "/admin/disputes", "/admin/audit",
]);
function isKnownClientRoute(urlPath: string): boolean {
  return exactClientRoutes.has(urlPath)
    || /^\/games\/[^/]+$/.test(urlPath)
    || /^\/matches\/[0-9a-f-]{36}$/i.test(urlPath)
    || /^\/support\/tickets\/[0-9a-f-]{36}$/i.test(urlPath);
}

export function createApp(deps: AppDependencies = {}): Express {
  const app = express();
  const trustProxy = Number(process.env.TRUST_PROXY ?? 0);
  if (Number.isInteger(trustProxy) && trustProxy >= 0 && trustProxy <= 3) app.set("trust proxy", trustProxy);
  app.disable("x-powered-by");
  // Cross-site Preview iframe requires the platform to frame this app. Do not set SAMEORIGIN/DENY.
  app.use(helmet({ frameguard: false, contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use((_req, res, next) => { res.setHeader("X-Request-ID", randomUUID()); next(); });
  app.use(express.json({ limit: "256kb", strict: true }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));

  app.use("/api", rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many requests. Try again shortly." } }), sessionMiddleware, requireCsrf);
  const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: process.env.NODE_ENV === "test" ? 100 : 8, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many authentication attempts. Try again later." } });

  app.get("/api/health", async (_req, res) => {
    if (!process.env.DATABASE_URL) { res.status(503).json({ ok: false, database: "not_configured", liveMoneyEnabled: isRealMoneyEnabled() }); return; }
    try {
      await getPool().query("SELECT 1");
      res.json({ ok: true, database: "reachable", liveMoneyEnabled: isRealMoneyEnabled() });
    } catch { res.status(503).json({ ok: false, database: "unavailable", liveMoneyEnabled: isRealMoneyEnabled() }); }
  });
  app.use("/api/auth", authLimit, createAuthRouter({ sendEmail: deps.emailSender ?? sendEmail }));
  app.use("/api/wallet", walletRouter);
  app.use("/api/payments", paymentRouter);
  app.use("/api/matches", createGamesRouter({ broadcast: deps.broadcast ?? (() => undefined) }));
  app.use("/api", userRouter);
  app.use("/api/admin", adminRouter);
  app.get("/api/games", (_req, res) => res.json({ games: [
    { slug: "chess", title: "Chess", status: "playable", rulesVersion: "chess.js-1.4", description: "Classic strategy with server-verified moves, configurable clocks and fair-play rules." },
    { slug: "checkers", title: "Checkers", status: "playable", rulesVersion: "american-checkers-8x8-v1", description: "American 8×8 checkers: mandatory captures, multi-jumps and king promotion." },
  ] }));

  if (process.env.NODE_ENV === "production") {
    app.use(express.static(clientDist, { index: false, maxAge: "1h", etag: true }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path === "/api" || /\.[A-Za-z0-9]{1,8}$/.test(req.path)) { next(); return; }
      res.status(isKnownClientRoute(req.path) ? 200 : 404).sendFile(path.join(clientDist, "index.html"));
    });
  } else deps.configureFrontend?.(app);

  app.use((req, res) => {
    if (req.path.startsWith("/api/")) { res.status(404).json({ error: "API route not found." }); return; }
    res.status(404).json({ error: "Not found." });
  });
  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 500;
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
    if (status >= 500) console.error(JSON.stringify({ level: "error", requestId: res.getHeader("X-Request-ID"), route: req.path, message: error instanceof Error ? error.message : "Unhandled error" }));
    res.status(status).json({ error: status >= 500 ? "The request could not be completed. Please try again." : error instanceof Error ? error.message : "Request rejected.", ...(code ? { code } : {}) });
  });
  return app;
}
