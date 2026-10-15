import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/sessions.js";
import { withTransaction } from "../db/pool.js";

export const verificationRouter = Router();
verificationRouter.use(requireAuth, requireRole("super_admin","verification"));

verificationRouter.get("/queue", async (_req, res) => {
  const { getPool } = await import("../db/pool.js");
  const result = await getPool().query(
    `SELECT r.id,r.status,r.requested_at,u.id AS user_id,u.username,u.email,u.email_verified_at
     FROM verification_requests r JOIN users u ON u.id=r.user_id
     WHERE r.status='pending' ORDER BY r.requested_at ASC LIMIT 100`,
  );
  res.json({ requests: result.rows, privacyNote: "Identity document images and identity numbers are not stored in this application." });
});

verificationRouter.post("/requests/:id/review", requireRole("super_admin","verification"), async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({ decision: z.enum(["approved","rejected"]), reason: z.string().trim().min(20).max(1000) }).safeParse(req.body);
  if (!id.success || !body.success) { res.status(400).json({ error: "A review decision and reason of at least 20 characters are required." }); return; }
  const result = await withTransaction(async (client) => {
    const request = await client.query<{ user_id: string; status: string }>("SELECT user_id,status FROM verification_requests WHERE id=$1 FOR UPDATE", [id.data]);
    if (!request.rows[0] || request.rows[0].status !== "pending") return null;
    await client.query("UPDATE verification_requests SET status=$2,reviewed_by=$3,review_reason=$4,reviewed_at=now() WHERE id=$1", [id.data, body.data.decision, req.auth!.user.id, body.data.reason]);
    if (body.data.decision === "approved") await client.query("UPDATE users SET age_verified_at=now(),identity_verified_at=now(),updated_at=now() WHERE id=$1", [request.rows[0].user_id]);
    await client.query(
      "INSERT INTO admin_audit_log(actor_user_id,action,target_type,target_id,reason,before_json,after_json) VALUES($1,'verification_review','verification_request',$2,$3,$4::jsonb,$5::jsonb)",
      [req.auth!.user.id, id.data, body.data.reason, JSON.stringify({ status: request.rows[0].status }), JSON.stringify({ status: body.data.decision })],
    );
    return { userId: request.rows[0].user_id, status: body.data.decision };
  });
  if (!result) { res.status(404).json({ error: "A pending verification request was not found." }); return; }
  res.json({ requestId: id.data, status: result.status, note: result.status === "approved" ? "Approval records an operator attestation that lawful age and identity checks were completed outside this system. No identity document was stored." : "Request rejected; the user may request review again." });
});
