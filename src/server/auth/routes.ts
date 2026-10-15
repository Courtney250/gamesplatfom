import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { getPool, withTransaction } from "../db/pool.js";
import { createWalletForUser } from "../ledger/wallet.js";
import { hashPassword, hashToken, verifyPassword, createOpaqueToken } from "./crypto.js";
import { EmailDeliveryUnavailable, type EmailSender, passwordResetEmail, verificationEmail } from "./email.js";
import { clearSessionCookieHeader, createSession, issueCsrfToken, requireAuth, revokeSession, sessionCookieHeader } from "./sessions.js";
import type { Response } from "express";

type EmailTemplate = { subject: string; text: string };
export type AuthDependencies = { sendEmail: EmailSender };
const registrationSchema = z.object({
  email: z.string().trim().email().max(254),
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(12).max(128),
  acceptedTerms: z.literal(true),
  acceptedPrivacy: z.literal(true),
});
const loginSchema = z.object({ identifier: z.string().trim().min(3).max(254), password: z.string().min(1).max(128) });
const tokenSchema = z.object({ token: z.string().min(32).max(128) });
const resetSchema = tokenSchema.extend({ password: z.string().min(12).max(128) });
const registrationNotice = "If the email and username are available, an account may be created and a verification message will be attempted. This response does not confirm account existence or email delivery.";
const verificationNotice = "If the account is eligible and email delivery is configured, a verification message will be attempted. This response does not confirm account existence or delivery.";
const resetNotice = "If the account exists and email delivery is configured, a password-reset message will be attempted. This response does not confirm account existence or delivery.";

let dummyHashPromise: Promise<string> | undefined;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("not-a-real-DuelKe-user-password-0");
  return dummyHashPromise;
}
function getTrustedAppBaseUrl(): string {
  const raw = process.env.APP_BASE_URL;
  if (!raw) throw new EmailDeliveryUnavailable();
  const url = new URL(raw);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("APP_BASE_URL must use HTTPS outside local development.");
  }
  return url.toString().replace(/\/$/, "");
}
function sendFailure(res: Response, error: unknown, notice: string): void {
  const category = error instanceof EmailDeliveryUnavailable ? "email_configuration_unavailable" : "email_provider_error";
  console.warn(JSON.stringify({ level: "warn", event: "outbound_email_unavailable", category }));
  res.status(202).json({ message: notice });
}
function tokenExpiry(purpose: "verify_email" | "reset_password"): Date {
  return new Date(Date.now() + (purpose === "verify_email" ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000));
}
async function createToken(userId: string, purpose: "verify_email" | "reset_password"): Promise<string> {
  const token = createOpaqueToken();
  await getPool().query("INSERT INTO email_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,$2,$3,$4)", [userId, purpose, hashToken(token), tokenExpiry(purpose)]);
  return token;
}

export function createAuthRouter(deps: AuthDependencies): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid registration." }); return; }
    const email = parsed.data.email.toLowerCase();
    const passwordHash = await hashPassword(parsed.data.password);
    const userId = randomUUID();
    const token = createOpaqueToken();
    try {
      await withTransaction(async (client) => {
        await client.query("INSERT INTO users(id,email,username,password_hash,terms_accepted_at,terms_version,privacy_notice_version) VALUES($1,$2,$3,$4,now(),'2026-10-15-v1','2026-10-15-v1')", [userId, email, parsed.data.username, passwordHash]);
        await createWalletForUser(client, userId);
        await client.query("INSERT INTO email_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,'verify_email',$2,$3)", [userId, hashToken(token), tokenExpiry("verify_email")]);
      });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      if (code === "23505") { res.status(202).json({ message: registrationNotice }); return; }
      throw error;
    }
    try {
      const template = verificationEmail(getTrustedAppBaseUrl(), token);
      await deps.sendEmail({ ...template, to: email });
      res.status(202).json({ message: registrationNotice });
    } catch (error) { sendFailure(res, error, registrationNotice); }
  });

  router.post("/verification/resend", async (req, res) => {
    const parsed = z.object({ email: z.string().trim().email().max(254) }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Enter a valid email address." }); return; }
    const found = await getPool().query<{ id: string; email: string }>("SELECT id,email FROM users WHERE lower(email)=$1 AND email_verified_at IS NULL AND status='active'", [parsed.data.email.toLowerCase()]);
    const user = found.rows[0];
    if (user) {
      const token = await createToken(user.id, "verify_email");
      try {
        const template = verificationEmail(getTrustedAppBaseUrl(), token);
        await deps.sendEmail({ ...template, to: user.email });
      } catch (error) { sendFailure(res, error, verificationNotice); return; }
    }
    res.status(202).json({ message: verificationNotice });
  });

  router.post("/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Enter a valid email/username and password." }); return; }
    const identifier = parsed.data.identifier.toLowerCase();
    const result = await getPool().query<{ id: string; password_hash: string; email_verified_at: Date | null; status: string }>(
      "SELECT id,password_hash,email_verified_at,status FROM users WHERE lower(email)=$1 OR lower(username)=$1 LIMIT 1", [identifier],
    );
    const user = result.rows[0];
    const passwordValid = await verifyPassword(parsed.data.password, user?.password_hash ?? await dummyHash());
    if (!user || !passwordValid || user.status !== "active" || !user.email_verified_at) { res.status(401).json({ error: "Sign-in could not be completed. Check the credentials and verify the account if needed." }); return; }
    const session = await createSession(user.id);
    res.setHeader("Set-Cookie", sessionCookieHeader(session.token));
    res.json({ message: "Signed in.", csrfToken: session.csrfToken, expiresAt: session.expiresAt.toISOString() });
  });

  router.get("/me", requireAuth, (req, res) => res.json({ user: req.auth!.user }));
  router.get("/csrf", requireAuth, async (req, res) => res.json({ csrfToken: await issueCsrfToken(req.auth!.sessionHash) }));
  router.post("/logout", requireAuth, async (req, res) => {
    await revokeSession(req.auth!.sessionHash);
    res.setHeader("Set-Cookie", clearSessionCookieHeader());
    res.json({ message: "Signed out." });
  });

  router.post("/verify-email", async (req, res) => {
    const parsed = tokenSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Verification link is invalid or expired." }); return; }
    const verified = await withTransaction(async (client) => {
      const result = await client.query<{ id: string; user_id: string }>(
        "SELECT id,user_id FROM email_tokens WHERE token_hash=$1 AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE", [hashToken(parsed.data.token)],
      );
      const row = result.rows[0];
      if (!row) return false;
      await client.query("UPDATE email_tokens SET consumed_at=now() WHERE id=$1", [row.id]);
      await client.query("UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=$1", [row.user_id]);
      return true;
    });
    if (!verified) { res.status(400).json({ error: "Verification link is invalid or expired." }); return; }
    res.json({ message: "Email verified. You can now sign in." });
  });

  router.post("/password-reset/request", async (req, res) => {
    const parsed = z.object({ email: z.string().trim().email().max(254) }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Enter a valid email address." }); return; }
    const result = await getPool().query<{ id: string; email: string }>("SELECT id,email FROM users WHERE lower(email)=$1 AND status='active'", [parsed.data.email.toLowerCase()]);
    const user = result.rows[0];
    if (user) {
      const token = await createToken(user.id, "reset_password");
      try {
        const template = passwordResetEmail(getTrustedAppBaseUrl(), token);
        await deps.sendEmail({ ...template, to: user.email });
      } catch (error) { sendFailure(res, error, resetNotice); return; }
    }
    res.status(202).json({ message: resetNotice });
  });

  router.post("/password-reset/complete", async (req, res) => {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid password reset." }); return; }
    const passwordHash = await hashPassword(parsed.data.password);
    const changed = await withTransaction(async (client) => {
      const result = await client.query<{ id: string; user_id: string }>(
        "SELECT id,user_id FROM email_tokens WHERE token_hash=$1 AND purpose='reset_password' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE", [hashToken(parsed.data.token)],
      );
      const row = result.rows[0];
      if (!row) return false;
      await client.query("UPDATE email_tokens SET consumed_at=now() WHERE id=$1", [row.id]);
      await client.query("UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2", [passwordHash, row.user_id]);
      await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [row.user_id]);
      return true;
    });
    if (!changed) { res.status(400).json({ error: "Reset link is invalid or expired." }); return; }
    res.json({ message: "Password updated. Sign in with your new password." });
  });
  return router;
}
