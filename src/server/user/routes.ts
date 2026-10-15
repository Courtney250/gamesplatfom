import { Router } from "express";
import { z } from "zod";
import { clearSessionCookieHeader, requireAuth } from "../auth/sessions.js";
import { getPool, withTransaction } from "../db/pool.js";
import { walletSummary } from "../ledger/wallet.js";
import { isRealMoneyEnabled } from "../../shared/config.js";

export const userRouter = Router();
userRouter.use(requireAuth);

userRouter.post("/account/self-exclude", async (req, res) => {
  const body = z.object({ confirm: z.literal(true) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Explicit confirmation is required to close and self-exclude this account." }); return; }
  const ticketId = await withTransaction(async (client) => {
    const user = await client.query<{ status: string; self_excluded_at: Date | null }>("SELECT status,self_excluded_at FROM users WHERE id=$1 FOR UPDATE", [req.auth!.user.id]);
    if (!user.rows[0] || user.rows[0].status !== "active" || user.rows[0].self_excluded_at) return null;
    const ticket = await client.query<{ id: string }>("INSERT INTO support_tickets(user_id,subject,priority) VALUES($1,'Self-exclusion and account closure','high') RETURNING id", [req.auth!.user.id]);
    await client.query("INSERT INTO support_messages(ticket_id,author_user_id,body) VALUES($1,$2,$3)", [ticket.rows[0]!.id, req.auth!.user.id, "The authenticated account holder requested immediate self-exclusion and account closure. Please retain this request for support follow-up."]);
    await client.query("UPDATE users SET status='closed',self_excluded_at=now(),updated_at=now() WHERE id=$1", [req.auth!.user.id]);
    await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [req.auth!.user.id]);
    await client.query("INSERT INTO admin_audit_log(actor_user_id,action,target_type,target_id,reason,before_json,after_json) VALUES($1,'self_exclusion','user',$2,'User-initiated immediate self-exclusion and account closure.',$3::jsonb,$4::jsonb)", [req.auth!.user.id, req.auth!.user.id, JSON.stringify({ status: user.rows[0].status }), JSON.stringify({ status: "closed", selfExcluded: true })]);
    return ticket.rows[0]!.id;
  });
  if (!ticketId) { res.status(409).json({ error: "This account is not eligible for another self-exclusion request." }); return; }
  res.setHeader("Set-Cookie", clearSessionCookieHeader());
  res.json({ status: "closed", ticketId, notice: "Your account is closed, all sessions are revoked, and your self-exclusion request is recorded. Save the support reference shown here." });
});

userRouter.get("/account/verification", async (req, res) => {
  const [user, request] = await Promise.all([
    getPool().query("SELECT age_verified_at,identity_verified_at FROM users WHERE id=$1", [req.auth!.user.id]),
    getPool().query("SELECT id,status,requested_at,review_reason,reviewed_at FROM verification_requests WHERE user_id=$1 ORDER BY requested_at DESC LIMIT 1", [req.auth!.user.id]),
  ]);
  const row = user.rows[0];
  res.json({ ageVerified: Boolean(row?.age_verified_at), identityVerified: Boolean(row?.identity_verified_at), request: request.rows[0] ?? null, notice: "Do not send identity documents through this form. Support will provide secure verification instructions." });
});
userRouter.post("/account/verification/request", async (req, res) => {
  const inserted = await getPool().query<{ id: string; requested_at: Date }>(
    "INSERT INTO verification_requests(user_id) VALUES($1) ON CONFLICT (user_id) WHERE status='pending' DO NOTHING RETURNING id,requested_at", [req.auth!.user.id],
  );
  if (inserted.rows[0]) { res.status(202).json({ request: inserted.rows[0], status: "pending", notice: "Request received. Do not send identity documents through this form." }); return; }
  const existing = await getPool().query("SELECT id,status,requested_at FROM verification_requests WHERE user_id=$1 AND status='pending'", [req.auth!.user.id]);
  res.status(202).json({ request: existing.rows[0] ?? null, status: "pending" });
});

userRouter.get("/dashboard", async (req, res) => {
  const userId = req.auth!.user.id;
  const [wallet, matchStats, pending, notifications, recent, verification, paymentTotals, activeMatches, supportTickets, disputes] = await Promise.all([
    walletSummary(userId),
    getPool().query<{ total: string; wins: string; losses: string; draws: string }>(
      `SELECT count(*)::text AS total,
         count(*) FILTER (WHERE m.winner_user_id=$1)::text AS wins,
         count(*) FILTER (WHERE m.winner_user_id IS NOT NULL AND m.winner_user_id<>$1)::text AS losses,
         count(*) FILTER (WHERE m.status='draw')::text AS draws
       FROM matches m JOIN match_players p ON p.match_id=m.id WHERE p.user_id=$1`, [userId],
    ),
    getPool().query("SELECT count(*)::text AS count FROM payment_requests WHERE user_id=$1 AND kind='withdrawal' AND status IN ('pending','processing','unknown')", [userId]),
    getPool().query("SELECT id,kind,title,body,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 8", [userId]),
    getPool().query("SELECT id,game,status,stake_kes::text,fee_kes::text,result,created_at FROM matches m WHERE EXISTS(SELECT 1 FROM match_players p WHERE p.match_id=m.id AND p.user_id=$1) ORDER BY created_at DESC LIMIT 50", [userId]),
    getPool().query("SELECT age_verified_at,identity_verified_at FROM users WHERE id=$1", [userId]),
    getPool().query(
      `SELECT COALESCE(sum(amount_kes) FILTER (WHERE kind='deposit' AND currency='KES' AND status='succeeded'),0)::text AS deposits_kes,
              COALESCE(sum(amount_kes) FILTER (WHERE kind='withdrawal' AND currency='KES' AND status='succeeded'),0)::text AS withdrawals_kes
       FROM payment_requests WHERE user_id=$1`, [userId],
    ),
    getPool().query(
      `SELECT m.id,m.game,m.status,m.stake_kes::text,m.created_at
       FROM matches m WHERE m.status IN ('ready','active')
       AND EXISTS(SELECT 1 FROM match_players p WHERE p.match_id=m.id AND p.user_id=$1)
       ORDER BY m.updated_at DESC LIMIT 10`, [userId],
    ),
    getPool().query("SELECT id,subject,status,priority,created_at,updated_at FROM support_tickets WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 20", [userId]),
    getPool().query(
      `SELECT d.id,d.match_id,d.reason,d.status,d.created_at
       FROM disputes d JOIN match_players p ON p.match_id=d.match_id
       WHERE p.user_id=$1 ORDER BY d.created_at DESC LIMIT 20`, [userId],
    ),
  ]);
  const stats = matchStats.rows[0] ?? { total: "0", wins: "0", losses: "0", draws: "0" };
  const total = Number(stats.total), wins = Number(stats.wins);
  res.json({
    user: req.auth!.user,
    wallet: { ...wallet, currency: "VIRTUAL_KES" },
    stats: { matches: total, wins, losses: Number(stats.losses), draws: Number(stats.draws), winRate: total ? Math.round((wins / total) * 100) : 0 },
    pendingWithdrawals: pending.rows[0]?.count ?? "0",
    paymentTotals: paymentTotals.rows[0] ?? { deposits_kes: "0", withdrawals_kes: "0" },
    activeMatches: activeMatches.rows,
    supportTickets: supportTickets.rows,
    disputes: disputes.rows,
    verification: { ageVerified: Boolean(verification.rows[0]?.age_verified_at), identityVerified: Boolean(verification.rows[0]?.identity_verified_at) },
    notifications: notifications.rows,
    recentMatches: recent.rows,
    realMoneyEnabled: isRealMoneyEnabled(),
  });
});

userRouter.get("/notifications", async (req, res) => {
  const result = await getPool().query("SELECT id,kind,title,body,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [req.auth!.user.id]);
  res.json({ notifications: result.rows });
});
userRouter.post("/notifications/:id/read", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid notification id." }); return; }
  const result = await getPool().query("UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id", [id.data, req.auth!.user.id]);
  if (!result.rowCount) { res.status(404).json({ error: "Notification not found." }); return; }
  res.json({ markedRead: true });
});

userRouter.get("/security", async (req, res) => {
  const result = await getPool().query<{ count: string; current: boolean }>(
    `SELECT count(*)::text AS count, bool_or(session_hash=$2) AS current
     FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()`, [req.auth!.user.id, req.auth!.sessionHash],
  );
  res.json({ activeSessions: result.rows[0]?.count ?? "0", currentSessionActive: result.rows[0]?.current ?? false, twoFactorEnabled: false, twoFactorAvailable: false });
});
userRouter.post("/security/revoke-other-sessions", async (req, res) => {
  const result = await getPool().query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND session_hash<>$2 AND revoked_at IS NULL", [req.auth!.user.id, req.auth!.sessionHash]);
  res.json({ revoked: result.rowCount ?? 0 });
});

userRouter.get("/support/tickets", async (req, res) => {
  const result = await getPool().query("SELECT id,subject,status,priority,created_at,updated_at FROM support_tickets WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50", [req.auth!.user.id]);
  res.json({ tickets: result.rows });
});
userRouter.post("/support/tickets", async (req, res) => {
  const body = z.object({ subject: z.string().trim().min(4).max(160), message: z.string().trim().min(20).max(4000) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid support request." }); return; }
  const ticket = await getPool().query<{ id: string }>("INSERT INTO support_tickets(user_id,subject) VALUES($1,$2) RETURNING id", [req.auth!.user.id, body.data.subject]);
  await getPool().query("INSERT INTO support_messages(ticket_id,author_user_id,body) VALUES($1,$2,$3)", [ticket.rows[0]!.id, req.auth!.user.id, body.data.message]);
  res.status(201).json({ ticketId: ticket.rows[0]!.id, status: "open" });
});
userRouter.get("/support/tickets/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid ticket id." }); return; }
  const ticket = await getPool().query("SELECT id,subject,status,priority,created_at,updated_at FROM support_tickets WHERE id=$1 AND user_id=$2", [id.data, req.auth!.user.id]);
  if (!ticket.rows[0]) { res.status(404).json({ error: "Ticket not found." }); return; }
  const messages = await getPool().query("SELECT id,author_user_id,body,created_at FROM support_messages WHERE ticket_id=$1 AND internal_note=false ORDER BY created_at", [id.data]);
  res.json({ ticket: ticket.rows[0], messages: messages.rows });
});
