import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/sessions.js";
import { applyMove, cancelQueue, cancelReadyMatch, historyForUser, matchForUser, queueForMatch, readyMatch, resignMatch } from "./service.js";

export type GameRouteDependencies = { broadcast: (matchId: string, event: string, payload: unknown) => void };
const matchIdSchema = z.string().uuid();

export function createGamesRouter(deps: GameRouteDependencies): Router {
  const router = Router();
  router.use(requireAuth);

  router.post("/queue", async (req, res) => {
    const result = await queueForMatch(req.auth!.user.id, req.body ?? {});
    if (result.status === "matched" && result.matchId) deps.broadcast(result.matchId, "match:updated", { status: "ready" });
    res.status(result.status === "matched" ? 201 : 202).json({ ...result, currency: "VIRTUAL_KES" });
  });

  router.post("/queue/:queueId/cancel", async (req, res) => {
    if (!matchIdSchema.safeParse(req.params.queueId).success) { res.status(400).json({ error: "Invalid queue id." }); return; }
    await cancelQueue(req.auth!.user.id, req.params.queueId);
    res.json({ status: "cancelled" });
  });

  router.get("/history", async (req, res) => res.json({ matches: await historyForUser(req.auth!.user.id) }));
  router.get("/:matchId", async (req, res) => {
    if (!matchIdSchema.safeParse(req.params.matchId).success) { res.status(400).json({ error: "Invalid match id." }); return; }
    res.json({ match: await matchForUser(req.auth!.user.id, req.params.matchId) });
  });

  router.post("/:matchId/ready", async (req, res) => {
    if (!matchIdSchema.safeParse(req.params.matchId).success) { res.status(400).json({ error: "Invalid match id." }); return; }
    const result = await readyMatch(req.auth!.user.id, req.params.matchId);
    deps.broadcast(req.params.matchId, "match:updated", result);
    res.json(result);
  });

  router.post("/:matchId/moves", async (req, res) => {
    if (!matchIdSchema.safeParse(req.params.matchId).success) { res.status(400).json({ error: "Invalid match id." }); return; }
    const result = await applyMove(req.auth!.user.id, req.params.matchId, req.body);
    deps.broadcast(req.params.matchId, "match:updated", result);
    res.json(result);
  });

  router.post("/:matchId/resign", async (req, res) => {
    if (!matchIdSchema.safeParse(req.params.matchId).success) { res.status(400).json({ error: "Invalid match id." }); return; }
    const result = await resignMatch(req.auth!.user.id, req.params.matchId);
    deps.broadcast(req.params.matchId, "match:updated", result);
    res.json(result);
  });

  router.post("/:matchId/cancel", async (req, res) => {
    if (!matchIdSchema.safeParse(req.params.matchId).success) { res.status(400).json({ error: "Invalid match id." }); return; }
    await cancelReadyMatch(req.auth!.user.id, req.params.matchId);
    const result = { matchId: req.params.matchId, status: "cancelled" };
    deps.broadcast(req.params.matchId, "match:updated", result);
    res.json(result);
  });

  router.post("/:matchId/disputes", async (req, res) => {
    if (!matchIdSchema.safeParse(req.params.matchId).success) { res.status(400).json({ error: "Invalid match id." }); return; }
    const body = z.object({ reason: z.string().trim().min(20).max(2000), evidence: z.array(z.string().url().max(2048)).max(10).default([]) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid dispute." }); return; }
    const result = await (await import("../db/pool.js")).withTransaction(async (client) => {
      const match = await client.query<{ status: string }>("SELECT status FROM matches WHERE id=$1 FOR UPDATE", [req.params.matchId]);
      if (!match.rows[0]) throw Object.assign(new Error("Match not found."), { status: 404 });
      const member = await client.query("SELECT 1 FROM match_players WHERE match_id=$1 AND user_id=$2", [req.params.matchId, req.auth!.user.id]);
      if (!member.rowCount) throw Object.assign(new Error("You are not a participant in this match."), { status: 403 });
      if (!["active","completed","draw","disputed"].includes(match.rows[0].status)) throw Object.assign(new Error("This match cannot be disputed."), { status: 409 });
      const inserted = await client.query<{ id: string }>("INSERT INTO disputes(match_id,opened_by,reason,evidence) VALUES($1,$2,$3,$4::jsonb) RETURNING id", [req.params.matchId, req.auth!.user.id, body.data.reason, JSON.stringify(body.data.evidence)]);
      if (match.rows[0].status === "active") await client.query("UPDATE matches SET status='disputed',updated_at=now() WHERE id=$1", [req.params.matchId]);
      return inserted.rows[0]!.id;
    });
    deps.broadcast(req.params.matchId, "match:disputed", { disputeId: result });
    res.status(201).json({ disputeId: result, status: "open" });
  });
  return router;
}
