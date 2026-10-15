import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getPool } from "../db/pool.js";
import { SESSION_TTL_MS } from "../../shared/config.js";
import { disconnectSessionSockets } from "../games/socket-registry.js";

type SessionUser = { id: string; email: string; username: string; role: string; status: string };
type AuthSession = { user: SessionUser; sessionHash: Buffer; csrfHash: Buffer };
declare global {
  namespace Express {
    interface Request { auth?: AuthSession }
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();
const cookieName = "duelke_session";
const cookieSecure = process.env.COOKIE_SECURE !== "false";

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return;
  for (const item of header.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
}

export function sessionCookieHeader(token: string, maxAgeMs = SESSION_TTL_MS): string {
  const parts = [`${cookieName}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=None", `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  const parts = [`${cookieName}=`, "Path=/", "HttpOnly", "SameSite=None", "Max-Age=0"];
  if (cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

export async function createSession(userId: string): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getPool().query("INSERT INTO sessions(session_hash,csrf_hash,user_id,expires_at) VALUES($1,$2,$3,$4)", [sha256(token), sha256(csrfToken), userId, expiresAt]);
  return { token, csrfToken, expiresAt };
}

export async function resolveSession(token: string): Promise<AuthSession | undefined> {
  const sessionHash = sha256(token);
  const result = await getPool().query<{ user_id: string; email: string; username: string; role: string; status: string; csrf_hash: Buffer }>(
    `SELECT s.user_id,u.email,u.username,u.role,u.status,s.csrf_hash
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.session_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active'`,
    [sessionHash],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  void getPool().query("UPDATE sessions SET last_seen_at=now() WHERE session_hash=$1", [sessionHash]).catch(() => undefined);
  return { user: { id: row.user_id, email: row.email, username: row.username, role: row.role, status: row.status }, sessionHash, csrfHash: row.csrf_hash };
}

export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readCookie(req.headers.cookie, cookieName);
    if (token && token.length <= 128) {
      const session = await resolveSession(token);
      if (session) req.auth = session;
    }
    next();
  } catch (error) { next(error); }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) { res.status(401).json({ error: "Authentication required." }); return; }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) { res.status(401).json({ error: "Authentication required." }); return; }
    if (!roles.includes(req.auth.user.role)) { res.status(403).json({ error: "Insufficient permission." }); return; }
    next();
  };
}

export async function issueCsrfToken(sessionHash: Buffer): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await getPool().query("UPDATE sessions SET csrf_hash=$1 WHERE session_hash=$2 AND revoked_at IS NULL", [sha256(token), sessionHash]);
  return token;
}

export async function requireCsrf(req: Request, res: Response, next: NextFunction): Promise<void> {
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase());
  if (!unsafe || !req.auth) { next(); return; }
  const supplied = req.header("x-csrf-token");
  if (!supplied || supplied.length > 128) { res.status(403).json({ error: "CSRF token required." }); return; }
  try {
    const current = await getPool().query<{ csrf_hash: Buffer }>("SELECT csrf_hash FROM sessions WHERE session_hash=$1 AND revoked_at IS NULL", [req.auth.sessionHash]);
    const storedHash = current.rows[0]?.csrf_hash;
    if (!storedHash) { res.status(403).json({ error: "CSRF token is no longer valid." }); return; }
    const candidate = sha256(supplied);
    if (candidate.length !== storedHash.length || !timingSafeEqual(candidate, storedHash)) { res.status(403).json({ error: "CSRF token is invalid." }); return; }
    next();
  } catch (error) { next(error); }
}

export async function revokeSession(sessionHash: Buffer): Promise<void> {
  const revoked = await getPool().query("UPDATE sessions SET revoked_at=now() WHERE session_hash=$1 AND revoked_at IS NULL RETURNING session_hash", [sessionHash]);
  if (revoked.rowCount) disconnectSessionSockets(sessionHash.toString("hex"));
}
export async function revokeAllSessions(userId: string): Promise<void> {
  const revoked = await getPool().query<{ session_hash: Buffer }>("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL RETURNING session_hash", [userId]);
  for (const row of revoked.rows) disconnectSessionSockets(row.session_hash.toString("hex"));
}


export function csrfTokenMatches(session: AuthSession, token: string): boolean {
  if (!token || token.length > 128) return false;
  const candidate = sha256(token);
  return candidate.length === session.csrfHash.length && timingSafeEqual(candidate, session.csrfHash);
}
