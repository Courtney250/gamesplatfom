import { Router } from "express";
import { z } from "zod";
import { assertRealMoneyEnabled } from "../../shared/config.js";
import { requireAuth } from "../auth/sessions.js";
import { getPool, withTransaction } from "../db/pool.js";
import { randomUUID } from "node:crypto";
import { parseKes } from "../../shared/money.js";
import { lockWallets, postLedgerTransaction } from "../ledger/posting.js";
import { getStkStatus, gatewayLimits, initiateStk } from "./courtneytech/client.js";

export const paymentRouter = Router();
paymentRouter.use(requireAuth);
const keySchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const phoneSchema = z.string().trim().min(9).max(18);
const amountSchema = z.unknown();
const completionStates = new Set(["completed"]);
const failureStates = new Set(["failed", "blocked", "cancelled"]);
function normalizeKenyanPhone(raw: string): string | null {
  const phone = raw.replace(/[\s()-]/g, "");
  return /^(?:\+?254|0)(?:7|1)\d{8}$/.test(phone) ? phone : null;
}
async function recordProviderEvent(paymentId: string, status: string, reference?: string | null, amount?: number, confirmed = false, eventType: "status_poll" | "deposit_confirmed" = "status_poll"): Promise<void> {
  await getPool().query(
    "INSERT INTO payment_reconciliation_events(payment_request_id,provider,event_type,provider_status,provider_reference,amount_kes,confirmed) VALUES($1,'courtneytech',$2,$3,$4,$5,$6)",
    [paymentId, eventType, status.slice(0, 40), reference?.slice(0, 160) ?? null, amount ?? null, confirmed],
  );
}
async function claimProviderPoll(paymentId: string, userId: string): Promise<boolean> {
  return withTransaction(async (client) => {
    const locked = await client.query<{ status: string; may_poll: boolean }>(
      "SELECT status,(updated_at <= now()-interval '5 seconds') AS may_poll FROM payment_requests WHERE id=$1 AND user_id=$2 AND gateway='courtneytech' AND kind='deposit' AND currency='KES' FOR UPDATE",
      [paymentId, userId],
    );
    const row = locked.rows[0];
    if (!row || ["succeeded", "failed", "blocked", "cancelled"].includes(row.status) || !row.may_poll) return false;
    await client.query("UPDATE payment_requests SET updated_at=now() WHERE id=$1", [paymentId]);
    return true;
  });
}
function asProviderError(error: unknown): { status: number; code?: string } {
  if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number") {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return { status: error.status, ...(code ? { code } : {}) };
  }
  return { status: 503, code: "PAYMENT_PROVIDER_UNAVAILABLE" };
}
function jsonError(res: import("express").Response, error: unknown): void {
  const mapped = asProviderError(error);
  res.status(mapped.status).json({ error: error instanceof Error ? error.message : "Payment request could not be completed.", ...(mapped.code ? { code: mapped.code } : {}) });
}
paymentRouter.post("/deposits", async (req, res) => {
  try { assertRealMoneyEnabled(); } catch (error) { jsonError(res, error); return; }
  const body = z.object({ amountKes: amountSchema, phone: phoneSchema }).safeParse(req.body);
  const key = keySchema.safeParse(req.header("idempotency-key"));
  if (!body.success || !key.success) { res.status(400).json({ error: "Provide a whole-KSh amount, Kenyan mobile number, and an 8–64 character Idempotency-Key." }); return; }
  const phone = normalizeKenyanPhone(body.data.phone);
  if (!phone) { res.status(400).json({ error: "Use a valid Kenyan M-Pesa mobile number." }); return; }
  let amount: bigint;
  try { amount = parseKes(body.data.amountKes, { min: BigInt(gatewayLimits.minimumKes), max: BigInt(gatewayLimits.maximumKes) }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid amount." }); return; }

  try {
    const payment = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`courtneytech:${key.data}`]);
      const prior = await client.query<{ id: string; user_id: string; amount_kes: string; status: string; kind: string; provider_request_id: string | null }>(
        "SELECT id,user_id,amount_kes::text,status,kind,provider_request_id FROM payment_requests WHERE gateway='courtneytech' AND idempotency_key=$1 FOR UPDATE", [key.data],
      );
      if (prior.rows[0]) {
        const row = prior.rows[0];
        if (row.kind !== "deposit" || row.user_id !== req.auth!.user.id || BigInt(row.amount_kes) !== amount) throw Object.assign(new Error("This Idempotency-Key was already used for a different payment."), { status: 409 });
        return { ...row, duplicate: true };
      }
      const id = randomUUID();
      await client.query(
        "INSERT INTO payment_requests(id,user_id,gateway,kind,currency,amount_kes,idempotency_key,status,metadata) VALUES($1,$2,'courtneytech','deposit','KES',$3,$4,'pending',$5::jsonb)",
        [id, req.auth!.user.id, amount.toString(), key.data, JSON.stringify({ phone })],
      );
      return { id, user_id: req.auth!.user.id, amount_kes: amount.toString(), status: "pending", provider_request_id: null, duplicate: false };
    });
    if (payment.duplicate) { res.status(202).json({ paymentId: payment.id, status: payment.status, providerRequestId: payment.provider_request_id, duplicate: true, notice: "Existing payment request returned; it was not submitted a second time." }); return; }
    const accepted = await initiateStk({ phone, amountKes: Number(amount), reference: `DK${payment.id.replaceAll("-", "").slice(0, 10)}`, description: "DuelKe deposit", idempotencyKey: key.data });
    await getPool().query("UPDATE payment_requests SET provider_request_id=$2,updated_at=now() WHERE id=$1 AND user_id=$3", [payment.id, accepted.requestId, req.auth!.user.id]);
    res.status(202).json({ paymentId: payment.id, status: "pending", providerRequestId: accepted.requestId, notice: "Payment prompt accepted. This is not a confirmed deposit; check status after completing the prompt." });
  } catch (error) { jsonError(res, error); }
});

paymentRouter.get("/deposits/:id", async (req, res) => {
  try { assertRealMoneyEnabled(); } catch (error) { jsonError(res, error); return; }
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid payment id." }); return; }
  try {
    const selected = await getPool().query<{ id: string; amount_kes: string; idempotency_key: string; status: string; provider_reference: string | null }>(
      "SELECT id,amount_kes::text,idempotency_key,status,provider_reference FROM payment_requests WHERE id=$1 AND user_id=$2 AND gateway='courtneytech' AND kind='deposit' AND currency='KES'", [id.data, req.auth!.user.id],
    );
    const payment = selected.rows[0];
    if (!payment) { res.status(404).json({ error: "Deposit request not found." }); return; }
    if (["succeeded", "failed", "blocked", "cancelled"].includes(payment.status)) { res.json({ paymentId: payment.id, status: payment.status, providerReference: payment.provider_reference }); return; }
    if (!await claimProviderPoll(payment.id, req.auth!.user.id)) { res.status(202).json({ paymentId: payment.id, status: payment.status, retryAfterSeconds: 5, notice: "Status is pending or was checked recently. Wait at least five seconds before checking again." }); return; }
    let provider: Awaited<ReturnType<typeof getStkStatus>>;
    try { provider = await getStkStatus(payment.idempotency_key); }
    catch (error) { await recordProviderEvent(payment.id, "provider_unavailable"); throw error; }
    await recordProviderEvent(payment.id, provider.status, provider.mpesaReceipt ?? provider.requestId, provider.amountKes, false);
    let status = provider.status;
    if (completionStates.has(status)) {
      if (provider.amountKes !== Number(payment.amount_kes)) {
        status = "unknown";
        await getPool().query("UPDATE payment_requests SET status='unknown',provider_reference=COALESCE($3,provider_reference),updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('pending','processing','unknown')", [payment.id, req.auth!.user.id, provider.mpesaReceipt ?? provider.requestId ?? null]);
      }
      else {
        const credited = await withTransaction(async (client) => {
          const locked = await client.query<{ user_id: string; amount_kes: string; status: string }>("SELECT user_id,amount_kes::text,status FROM payment_requests WHERE id=$1 AND gateway='courtneytech' AND kind='deposit' AND currency='KES' FOR UPDATE", [payment.id]);
          const row = locked.rows[0];
          if (!row || row.user_id !== req.auth!.user.id) throw Object.assign(new Error("Deposit request not found."), { status: 404 });
          if (row.status === "succeeded") return true;
          if (!["pending", "processing", "unknown"].includes(row.status)) return false;
          const amount = BigInt(row.amount_kes);
          await lockWallets(client, [row.user_id], "cash");
          await postLedgerTransaction(client, {
            transactionType: "cash_deposit_confirmed", currency: "KES", sourceType: "payment_request", sourceId: payment.id,
            idempotencyKey: `cash-deposit:${payment.id}`, description: "Provider-confirmed M-Pesa deposit.",
            lines: [
              { accountCode: "system.cash_clearing", direction: "debit", amountKes: amount },
              { accountCode: `user.${row.user_id}.cash.available`, direction: "credit", amountKes: amount },
            ],
          });
          const reference = provider.mpesaReceipt ?? provider.requestId ?? null;
          await client.query("UPDATE payment_requests SET status='succeeded',provider_reference=COALESCE($2,provider_reference),confirmed_at=now(),updated_at=now() WHERE id=$1", [payment.id, reference]);
          await client.query(
            "INSERT INTO payment_reconciliation_events(payment_request_id,provider,event_type,provider_status,provider_reference,amount_kes,confirmed) VALUES($1,'courtneytech','deposit_confirmed',$2,$3,$4,true)",
            [payment.id, provider.status.slice(0, 40), reference?.slice(0, 160) ?? null, provider.amountKes],
          );
          return true;
        });
        if (!credited) { res.status(202).json({ paymentId: payment.id, status: "unknown", notice: "Provider reported completion after this request reached a terminal failure state. No credit was made; manual reconciliation is required." }); return; }
        res.json({ paymentId: payment.id, status: "succeeded", providerReference: provider.mpesaReceipt ?? provider.requestId ?? null }); return;
      }
    } else if (failureStates.has(status)) {
      await getPool().query("UPDATE payment_requests SET status=$3,updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('pending','processing','unknown')", [payment.id, req.auth!.user.id, status]);
    } else {
      await getPool().query("UPDATE payment_requests SET status=$3,provider_reference=COALESCE($4,provider_reference),updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('pending','processing','unknown')", [payment.id, req.auth!.user.id, status === "unknown" ? "unknown" : status, provider.mpesaReceipt ?? provider.requestId ?? null]);
    }
    res.status(202).json({ paymentId: payment.id, status, notice: status === "unknown" ? "Provider status or amount could not be confirmed. No wallet credit was made." : "No deposit credit is made until the provider confirms a matching completed amount." });
  } catch (error) { jsonError(res, error); }
});

paymentRouter.post("/withdrawals", async (_req, res) => {
  try { assertRealMoneyEnabled(); } catch (error) { jsonError(res, error); return; }
  // Courtney Tech documents /v2/payouts as an authorized winner-payout product,
  // not a generic user cash-withdrawal API. Do not submit withdrawals as winner payouts.
  res.status(501).json({
    error: "User withdrawals are not supported by the documented Courtney Tech payout product. The provider must confirm and authorize a suitable withdrawal API before this route can be implemented.",
    code: "USER_WITHDRAWALS_PROVIDER_UNSUPPORTED",
  });
});

paymentRouter.get("/withdrawals/:id", async (_req, res) => {
  try { assertRealMoneyEnabled(); } catch (error) { jsonError(res, error); return; }
  res.status(501).json({
    error: "Withdrawal status cannot be queried until Courtney Tech confirms a supported user-withdrawal product.",
    code: "USER_WITHDRAWALS_PROVIDER_UNSUPPORTED",
  });
});
