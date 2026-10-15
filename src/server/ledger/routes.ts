import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/sessions.js";
import { getPool } from "../db/pool.js";
import { parseKes } from "../../shared/money.js";
import { isRealMoneyEnabled } from "../../shared/config.js";
import { simulateDeposit, walletSummary } from "./wallet.js";

export const walletRouter = Router();
walletRouter.use(requireAuth);

walletRouter.get("/", async (req, res) => {
  const balances = await walletSummary(req.auth!.user.id);
  res.json({ currency: "VIRTUAL_KES", ...balances, liveMoneyEnabled: isRealMoneyEnabled() });
});

walletRouter.get("/transactions", async (req, res) => {
  const result = await getPool().query(
    `SELECT p.id,p.gateway,p.kind,p.currency,p.amount_kes::text,p.status,p.provider_reference,p.created_at,p.confirmed_at
     FROM payment_requests p WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 100`, [req.auth!.user.id],
  );
  const ledger = await getPool().query(
    `SELECT t.id,t.transaction_type,t.source_type,t.source_id,t.description,t.created_at,
       json_agg(json_build_object('direction',e.direction,'amountKes',e.amount_kes::text,'account',a.code)) AS entries
     FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id JOIN ledger_accounts a ON a.id=e.account_id
     WHERE a.owner_user_id=$1 GROUP BY t.id ORDER BY t.created_at DESC LIMIT 100`, [req.auth!.user.id],
  );
  res.json({ payments: result.rows, ledger: ledger.rows });
});

walletRouter.post("/virtual-credits", async (req, res) => {
  if (isRealMoneyEnabled()) { res.status(403).json({ error: "Virtual credit simulation is disabled while live-money mode is active." }); return; }
  const amountRaw = (req.body as { amountKes?: unknown } | undefined)?.amountKes;
  let amount: bigint;
  try { amount = parseKes(amountRaw, { min: 1n, max: 10_000n }); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid amount." }); return; }
  const key = req.header("idempotency-key");
  if (!key || !/^[A-Za-z0-9_-]{8,64}$/.test(key)) { res.status(400).json({ error: "Provide an 8–64 character Idempotency-Key." }); return; }
  try {
    const result = await simulateDeposit(req.auth!.user.id, amount, key);
    res.status(result.duplicate ? 200 : 201).json({ ...result, currency: "VIRTUAL_KES", notice: "Simulation only: no cash or M-Pesa transaction occurred." });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Idempotency key")) { res.status(409).json({ error: error.message }); return; }
    throw error;
  }
});

walletRouter.post("/withdrawals", async (_req, res) => {
  if (!isRealMoneyEnabled()) { res.status(403).json({ error: "Cash withdrawals are disabled. Virtual credits have no cash value." }); return; }
  res.status(501).json({ error: "Withdrawal workflow is not active until payment-provider payout status and eligibility are configured and verified." });
});
