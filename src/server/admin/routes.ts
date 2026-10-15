import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/sessions.js";
import { getPool, withTransaction } from "../db/pool.js";
import { verificationRouter } from "./verification.js";
import { isRealMoneyEnabled } from "../../shared/config.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);

adminRouter.get("/overview", requireRole("super_admin","finance","support","verification"), async (_req, res) => {
  const [users, matches, money, disputes, queues, verification, support] = await Promise.all([
    getPool().query("SELECT count(*)::text AS total,count(*) FILTER (WHERE status='active')::text AS active,count(*) FILTER (WHERE email_verified_at IS NOT NULL)::text AS verified FROM users"),
    getPool().query("SELECT count(*)::text AS total,count(*) FILTER (WHERE status='active')::text AS active,count(*) FILTER (WHERE status='completed')::text AS completed FROM matches"),
    getPool().query("SELECT count(*) FILTER (WHERE kind='deposit' AND status='pending')::text AS pending_deposits,count(*) FILTER (WHERE kind='withdrawal' AND status IN ('pending','processing','unknown'))::text AS pending_withdrawals FROM payment_requests"),
    getPool().query("SELECT count(*)::text AS open FROM disputes WHERE status IN ('open','investigating','appealed')"),
    getPool().query("SELECT count(*)::text AS waiting FROM matchmaking_queue WHERE status='waiting' AND expires_at>now()"),
    getPool().query("SELECT count(*)::text AS pending FROM verification_requests WHERE status='pending'"),
    getPool().query("SELECT count(*)::text AS open FROM support_tickets WHERE status IN ('open','pending')"),
  ]);
  res.json({ users: users.rows[0], matches: matches.rows[0], payments: money.rows[0], openDisputes: disputes.rows[0]?.open ?? "0", waitingQueues: queues.rows[0]?.waiting ?? "0", pendingVerification: verification.rows[0]?.pending ?? "0", openSupportTickets: support.rows[0]?.open ?? "0", liveMoneyEnabled: isRealMoneyEnabled() });
});

adminRouter.get("/users", requireRole("super_admin","verification"), async (req, res) => {
  const page = Math.max(1, Math.min(10_000, Number(req.query.page) || 1));
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
  const result = await getPool().query("SELECT id,email,username,role,status,email_verified_at,age_verified_at,identity_verified_at,created_at FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2", [limit, (page - 1) * limit]);
  res.json({ users: result.rows, page, limit });
});

adminRouter.post("/users/:id/status", requireRole("super_admin"), async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({ status: z.enum(["active","suspended","closed"]), reason: z.string().trim().min(12).max(1000) }).safeParse(req.body);
  if (!id.success || !body.success) { res.status(400).json({ error: "Valid user id, status and a reason are required." }); return; }
  const result = await withTransaction(async (client) => {
    const before = await client.query<{ id: string; status: string; email: string; role: string }>("SELECT id,status,email,role FROM users WHERE id=$1 FOR UPDATE", [id.data]);
    if (!before.rows[0]) return null;
    await client.query("UPDATE users SET status=$2,updated_at=now() WHERE id=$1", [id.data, body.data.status]);
    if (body.data.status !== "active") await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [id.data]);
    await client.query("INSERT INTO admin_audit_log(actor_user_id,action,target_type,target_id,reason,before_json,after_json) VALUES($1,'user_status_change','user',$2,$3,$4::jsonb,$5::jsonb)", [req.auth!.user.id, id.data, body.data.reason, JSON.stringify(before.rows[0]), JSON.stringify({ ...before.rows[0], status: body.data.status })]);
    return { id: id.data, status: body.data.status };
  });
  if (!result) { res.status(404).json({ error: "User not found." }); return; }
  res.json({ user: result });
});

adminRouter.get("/matches", requireRole("super_admin","support","verification"), async (_req, res) => {
  const result = await getPool().query(
    `SELECT m.id,m.game,m.status,m.stake_kes::text,m.fee_kes::text,m.result,m.created_at,m.finished_at,
       json_agg(json_build_object('username',u.username,'seat',p.seat) ORDER BY p.seat) AS players
     FROM matches m JOIN match_players p ON p.match_id=m.id JOIN users u ON u.id=p.user_id
     GROUP BY m.id ORDER BY m.created_at DESC LIMIT 100`,
  );
  res.json({ matches: result.rows });
});

adminRouter.get("/finance", requireRole("super_admin","finance"), async (_req, res) => {
  const [fees, disputedFees, costs, payments, unsettled] = await Promise.all([
    getPool().query(`SELECT COALESCE(sum(m.fee_kes),0)::text AS gross_virtual_match_fees
      FROM matches m WHERE m.status='completed'
      AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.match_id=m.id)`),
    getPool().query(`SELECT count(*)::text AS count,COALESCE(sum(m.fee_kes),0)::text AS fees_kes
      FROM matches m WHERE m.status='completed'
      AND EXISTS (SELECT 1 FROM disputes d WHERE d.match_id=m.id)`),
    getPool().query("SELECT COALESCE(sum(CASE WHEN e.direction=a.normal_side THEN e.amount_kes ELSE -e.amount_kes END),0)::text AS provider_costs_kes FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id WHERE a.code='system.provider_costs'"),
    getPool().query("SELECT gateway,kind,currency,status,count(*)::text AS count,COALESCE(sum(amount_kes),0)::text AS amount FROM payment_requests GROUP BY gateway,kind,currency,status ORDER BY gateway,kind,currency,status"),
    getPool().query("SELECT count(*)::text AS count,COALESCE(sum(stake_kes),0)::text AS stake FROM matches WHERE status IN ('active','disputed')"),
  ]);
  res.json({
    grossVirtualMatchFeesKes: fees.rows[0]?.gross_virtual_match_fees ?? "0",
    disputedCompletedVirtualMatchFeesKes: disputedFees.rows[0]?.fees_kes ?? "0",
    disputedCompletedMatchCount: disputedFees.rows[0]?.count ?? "0",
    recordedProviderCostsKes: costs.rows[0]?.provider_costs_kes ?? "0",
    payments: payments.rows,
    unsettledVirtualMatches: unsettled.rows[0],
    note: "Gross virtual fees exclude every completed match with a dispute record; those amounts are shown separately and are not treated as confirmed. Virtual fees are not cash revenue. Provider costs are cash amounts and are shown separately. Net profit is not calculated; taxes, refunds, chargebacks and operating costs are not fully modeled.",
  });
});

adminRouter.get("/payments/reconciliation", requireRole("super_admin","finance"), async (_req, res) => {
  const requests = await getPool().query(
    `SELECT p.id,p.user_id,p.kind,p.currency,p.amount_kes::text,p.status,p.provider_request_id,p.provider_reference,p.created_at,p.updated_at,
       (SELECT e.provider_status FROM payment_reconciliation_events e WHERE e.payment_request_id=p.id ORDER BY e.created_at DESC LIMIT 1) AS last_provider_status,
       (SELECT e.created_at FROM payment_reconciliation_events e WHERE e.payment_request_id=p.id ORDER BY e.created_at DESC LIMIT 1) AS last_checked_at
     FROM payment_requests p WHERE p.gateway='courtneytech' AND p.currency='KES'
     ORDER BY CASE WHEN p.status IN ('pending','processing','unknown') THEN 0 ELSE 1 END,p.updated_at DESC LIMIT 200`,
  );
  res.json({ requests: requests.rows, liveMoneyEnabled: isRealMoneyEnabled(), note: "Status evidence is informational. Pending/unknown requests are not revenue or successful transfers; review provider statements before resolving discrepancies." });
});

adminRouter.get("/payments/reconciliation/:id/events", requireRole("super_admin","finance"), async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid payment id." }); return; }
  const exists = await getPool().query("SELECT 1 FROM payment_requests WHERE id=$1 AND gateway='courtneytech' AND currency='KES'", [id.data]);
  if (!exists.rowCount) { res.status(404).json({ error: "Payment request not found." }); return; }
  const events = await getPool().query(
    "SELECT id,event_type,provider_status,provider_reference,amount_kes::text,confirmed,created_at FROM payment_reconciliation_events WHERE payment_request_id=$1 ORDER BY created_at DESC LIMIT 100", [id.data],
  );
  res.json({ events: events.rows });
});

adminRouter.get("/disputes", requireRole("super_admin","support"), async (_req, res) => {
  const result = await getPool().query(`SELECT d.id,d.match_id,d.reason,d.evidence,d.status,d.resolution,d.created_at,d.resolved_at,u.username AS opened_by FROM disputes d JOIN users u ON u.id=d.opened_by ORDER BY d.created_at DESC LIMIT 100`);
  res.json({ disputes: result.rows });
});
adminRouter.post("/disputes/:id/review", requireRole("super_admin","support"), async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({ status: z.enum(["investigating","resolved","appealed","closed"]), resolution: z.string().trim().min(12).max(2000) }).safeParse(req.body);
  if (!id.success || !body.success) { res.status(400).json({ error: "Valid review status and resolution note are required." }); return; }
  const result = await withTransaction(async (client) => {
    const existing = await client.query<{ status: string; match_id: string }>("SELECT status,match_id FROM disputes WHERE id=$1 FOR UPDATE", [id.data]);
    if (!existing.rows[0]) return false;
    await client.query("UPDATE disputes SET status=$2,resolution=$3,reviewed_by=$4,resolved_at=CASE WHEN $2 IN ('resolved','closed') THEN now() ELSE NULL END WHERE id=$1", [id.data, body.data.status, body.data.resolution, req.auth!.user.id]);
    await client.query("INSERT INTO admin_audit_log(actor_user_id,action,target_type,target_id,reason,before_json,after_json) VALUES($1,'dispute_review','dispute',$2,$3,$4::jsonb,$5::jsonb)", [req.auth!.user.id, id.data, body.data.resolution, JSON.stringify(existing.rows[0]), JSON.stringify(body.data)]);
    return true;
  });
  if (!result) { res.status(404).json({ error: "Dispute not found." }); return; }
  res.json({ disputeId: id.data, status: body.data.status, note: "Review recorded; this action does not alter posted ledger entries." });
});

adminRouter.get("/audit", requireRole("super_admin","finance"), async (_req, res) => {
  const result = await getPool().query("SELECT id,actor_user_id,action,target_type,target_id,reason,before_json,after_json,created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT 200");
  res.json({ entries: result.rows });
});

adminRouter.get("/settings", requireRole("super_admin","finance"), async (_req, res) => {
  const result = await getPool().query("SELECT key,value_json,updated_at FROM platform_settings ORDER BY key");
  res.json({ settings: result.rows, realMoneyEnabled: isRealMoneyEnabled() });
});
adminRouter.post("/settings/service-fee", requireRole("super_admin"), async (req, res) => {
  const body = z.object({ feeBps: z.number().int().min(0).max(5000), reason: z.string().trim().min(12).max(1000) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Fee must be 0–5,000 basis points and include a reason." }); return; }
  await withTransaction(async (client) => {
    const before = await client.query("SELECT value_json FROM platform_settings WHERE key='service_fee_bps' FOR UPDATE");
    await client.query("UPDATE platform_settings SET value_json=$1::jsonb,updated_by=$2,updated_at=now() WHERE key='service_fee_bps'", [JSON.stringify(body.data.feeBps), req.auth!.user.id]);
    await client.query("INSERT INTO admin_audit_log(actor_user_id,action,target_type,target_id,reason,before_json,after_json) VALUES($1,'service_fee_change','platform_setting','service_fee_bps',$2,$3::jsonb,$4::jsonb)", [req.auth!.user.id, body.data.reason, JSON.stringify(before.rows[0] ?? null), JSON.stringify({ feeBps: body.data.feeBps })]);
  });
  res.json({ feeBps: body.data.feeBps, note: "This affects new virtual-credit matches only; existing fee snapshots are unchanged." });
});

adminRouter.use("/verification", verificationRouter);

adminRouter.get("/support/tickets", requireRole("super_admin","support"), async (_req, res) => {
  const result = await getPool().query(
    `SELECT t.id,t.subject,t.status,t.priority,t.created_at,t.updated_at,u.username,u.email,
       (SELECT count(*)::text FROM support_messages m WHERE m.ticket_id=t.id AND m.internal_note=false) AS message_count
     FROM support_tickets t JOIN users u ON u.id=t.user_id ORDER BY CASE WHEN t.status='open' THEN 0 WHEN t.status='pending' THEN 1 ELSE 2 END,t.updated_at DESC LIMIT 100`,
  );
  res.json({ tickets: result.rows });
});
adminRouter.get("/support/tickets/:id", requireRole("super_admin","support"), async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid ticket id." }); return; }
  const ticket = await getPool().query("SELECT t.id,t.subject,t.status,t.priority,t.created_at,t.updated_at,u.username,u.email FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE t.id=$1", [id.data]);
  if (!ticket.rows[0]) { res.status(404).json({ error: "Ticket not found." }); return; }
  const messages = await getPool().query("SELECT id,author_user_id,body,internal_note,created_at FROM support_messages WHERE ticket_id=$1 ORDER BY created_at", [id.data]);
  res.json({ ticket: ticket.rows[0], messages: messages.rows });
});
adminRouter.post("/support/tickets/:id/messages", requireRole("super_admin","support"), async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({ body: z.string().trim().min(20).max(4000), internalNote: z.boolean().default(false) }).safeParse(req.body);
  if (!id.success || !body.success) { res.status(400).json({ error: "A valid ticket id and message of 20–4,000 characters are required." }); return; }
  const result = await withTransaction(async (client) => {
    const ticket = await client.query<{ user_id: string; status: string }>("SELECT user_id,status FROM support_tickets WHERE id=$1 FOR UPDATE", [id.data]);
    if (!ticket.rows[0]) return null;
    if (ticket.rows[0].status === "closed") return { closed: true as const };
    const message = await client.query<{ id: string }>("INSERT INTO support_messages(ticket_id,author_user_id,body,internal_note) VALUES($1,$2,$3,$4) RETURNING id", [id.data, req.auth!.user.id, body.data.body, body.data.internalNote]);
    await client.query("UPDATE support_tickets SET status=CASE WHEN status='open' THEN 'pending' ELSE status END,updated_at=now() WHERE id=$1", [id.data]);
    const action = body.data.internalNote ? "support_internal_note" : "support_reply";
    await client.query("INSERT INTO admin_audit_log(actor_user_id,action,target_type,target_id,reason,before_json,after_json) VALUES($1,$2,'support_ticket',$3,$4,$5::jsonb,$6::jsonb)", [req.auth!.user.id, action, id.data, body.data.internalNote ? "Internal note added." : "Support reply added.", JSON.stringify({ status: ticket.rows[0].status }), JSON.stringify({ status: "pending" })]);
    if (!body.data.internalNote) await client.query("INSERT INTO notifications(user_id,kind,title,body) VALUES($1,'support_reply','Support updated your ticket','A support response was added to your ticket. Sign in to review it.')", [ticket.rows[0].user_id]);
    return { closed: false as const, messageId: message.rows[0]!.id };
  });
  if (!result) { res.status(404).json({ error: "Ticket not found." }); return; }
  if (result.closed) { res.status(409).json({ error: "This ticket is closed; reopen it before posting." }); return; }
  res.status(201).json({ messageId: result.messageId, internalNote: body.data.internalNote });
});
adminRouter.post("/support/tickets/:id/status", requireRole("super_admin","support"), async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({ status: z.enum(["open","pending","resolved","closed"]), reason: z.string().trim().min(12).max(1000) }).safeParse(req.body);
  if (!id.success || !body.success) { res.status(400).json({ error: "Valid ticket id, status and reason are required." }); return; }
  const result = await withTransaction(async (client) => {
    const ticket = await client.query<{ user_id: string; status: string }>("SELECT user_id,status FROM support_tickets WHERE id=$1 FOR UPDATE", [id.data]);
    if (!ticket.rows[0]) return null;
    await client.query("UPDATE support_tickets SET status=$2,updated_at=now() WHERE id=$1", [id.data, body.data.status]);
    await client.query("INSERT INTO admin_audit_log(actor_user_id,action,target_type,target_id,reason,before_json,after_json) VALUES($1,'support_status_change','support_ticket',$2,$3,$4::jsonb,$5::jsonb)", [req.auth!.user.id, id.data, body.data.reason, JSON.stringify({ status: ticket.rows[0].status }), JSON.stringify({ status: body.data.status })]);
    await client.query("INSERT INTO notifications(user_id,kind,title,body) VALUES($1,'support_status','Support ticket status changed',$2)", [ticket.rows[0].user_id, `Your support request is now ${body.data.status}.`]);
    return { userId: ticket.rows[0].user_id };
  });
  if (!result) { res.status(404).json({ error: "Ticket not found." }); return; }
  res.json({ status: body.data.status, notice: "Ticket status updated and recorded in the audit log." });
});
