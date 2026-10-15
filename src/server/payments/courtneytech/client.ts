import { assertRealMoneyEnabled } from "../../../shared/config.js";

const BASE_URL = "https://pay.courtneytech.space/api";
const AMOUNT_MIN = 1;
const AMOUNT_MAX = 70_000;

export type CourtneyStatus = "pending" | "processing" | "completed" | "cancelled" | "failed" | "blocked" | "unknown";
export type CourtneyStkInput = { phone: string; amountKes: number; reference: string; description: string; idempotencyKey: string; paymentAccountId?: number };
export type CourtneyPayoutInput = { phone: string; amountKes: number; description: string; matchId: string; idempotencyKey: string };

function endpoint(path: string): URL { return new URL(`${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`); }
function credentials(): { key: string; secret: string } {
  const key = process.env.B2CCOURTNEY_API_KEY;
  const secret = process.env.B2CCOURTNEY_API_SECRET;
  if (!key || !secret) throw Object.assign(new Error("Courtney Tech API credentials are not configured."), { status: 503, code: "GATEWAY_NOT_CONFIGURED" });
  return { key, secret };
}
function validatePhone(phone: string): string {
  const normalized = phone.replace(/[\s()-]/g, "");
  if (!/^(?:\+?254|0)(?:7|1)\d{8}$/.test(normalized)) throw new Error("Use a valid Kenyan M-Pesa mobile number.");
  return normalized.startsWith("0") ? `+254${normalized.slice(1)}` : `+${normalized.replace(/^\+?/, "")}`;
}
function validateAmount(amountKes: number): void {
  if (!Number.isSafeInteger(amountKes) || amountKes < AMOUNT_MIN || amountKes > AMOUNT_MAX) throw new Error(`Gateway amount must be a whole KSh value from ${AMOUNT_MIN} to ${AMOUNT_MAX}.`);
}
async function requestJson<T>(url: URL, init: RequestInit): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8_000);
  try {
    const response = await fetch(url, { ...init, signal: abort.signal, redirect: "error" });
    const text = await response.text();
    if (text.length > 100_000) throw new Error("Payment gateway response exceeded the allowed size.");
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new Error("Payment gateway returned invalid JSON."); }
    if (!response.ok) {
      const message = typeof data === "object" && data !== null && "message" in data && typeof data.message === "string" ? data.message : "Payment gateway request failed.";
      throw Object.assign(new Error(message), { status: response.status, code: "GATEWAY_REQUEST_FAILED" });
    }
    return data as T;
  } finally { clearTimeout(timer); }
}
function authHeaders(idempotencyKey?: string): Record<string, string> {
  const { key, secret } = credentials();
  return { "X-API-Key": key, "X-API-Secret": secret, "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) };
}

export async function initiateStk(input: CourtneyStkInput): Promise<{ requestId: string; checkoutRequestId?: string }> {
  assertRealMoneyEnabled();
  validateAmount(input.amountKes);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.idempotencyKey)) throw new Error("A valid idempotency key is required.");
  const reference = input.reference.slice(0, 12).replace(/[^A-Za-z0-9]/g, "") || "DUELKE";
  const data = await requestJson<{ success?: boolean; requestId?: string; request_id?: string; checkoutRequestId?: string }>(endpoint("/v2/b2c/stk"), {
    method: "POST",
    headers: authHeaders(input.idempotencyKey),
    body: JSON.stringify({
      phone_number: validatePhone(input.phone),
      amount_kes: input.amountKes,
      reference,
      description: input.description.slice(0, 13),
      ...(input.paymentAccountId === undefined ? {} : { payment_account_id: input.paymentAccountId }),
    }),
  });
  const requestId = data.requestId ?? data.request_id;
  if (data.success === false || !requestId) throw new Error("Gateway did not return an accepted request reference; no payment is confirmed.");
  return { requestId, ...(data.checkoutRequestId ? { checkoutRequestId: data.checkoutRequestId } : {}) };
}

export type CourtneyPaymentStatus = { status: CourtneyStatus; requestId?: string; checkoutRequestId?: string; amountKes?: number; mpesaReceipt?: string | null; payoutStatus?: string | null; payoutAmountCents?: number | null };
export async function getStkStatus(idempotencyKey: string): Promise<CourtneyPaymentStatus> {
  assertRealMoneyEnabled();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(idempotencyKey)) throw new Error("A valid idempotency key is required.");
  const url = endpoint("/v2/b2c/status");
  url.searchParams.set("request_id", idempotencyKey);
  const data = await requestJson<Record<string, unknown>>(url, { method: "GET", headers: authHeaders() });
  const allowed: CourtneyStatus[] = ["pending", "processing", "completed", "cancelled", "failed", "blocked", "unknown"];
  const raw = typeof data.status === "string" ? data.status.toLowerCase() : "unknown";
  const status = allowed.includes(raw as CourtneyStatus) ? raw as CourtneyStatus : "unknown";
  const amount = typeof data.amountKes === "number" && Number.isSafeInteger(data.amountKes) ? data.amountKes : undefined;
  return {
    status,
    ...(typeof data.requestId === "string" ? { requestId: data.requestId } : {}),
    ...(typeof data.checkoutRequestId === "string" ? { checkoutRequestId: data.checkoutRequestId } : {}),
    ...(amount === undefined ? {} : { amountKes: amount }),
    ...(typeof data.mpesaReceipt === "string" || data.mpesaReceipt === null ? { mpesaReceipt: data.mpesaReceipt } : {}),
    ...(typeof data.payoutStatus === "string" || data.payoutStatus === null ? { payoutStatus: data.payoutStatus } : {}),
    ...(typeof data.payoutAmountCents === "number" || data.payoutAmountCents === null ? { payoutAmountCents: data.payoutAmountCents } : {}),
  };
}

export async function requestWinnerPayout(input: CourtneyPayoutInput): Promise<{ status: CourtneyStatus; requestId?: string; transactionId?: string }> {
  assertRealMoneyEnabled();
  if (process.env.COURTNEY_PAYOUTS_ENABLED !== "true") throw Object.assign(new Error("Winner payouts require a separately approved API key with the payouts:create scope."), { status: 403, code: "PAYOUT_SCOPE_NOT_ENABLED" });
  validateAmount(input.amountKes);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.idempotencyKey)) throw new Error("A valid idempotency key is required.");
  const data = await requestJson<Record<string, unknown>>(endpoint("/v2/payouts"), {
    method: "POST",
    headers: authHeaders(input.idempotencyKey),
    body: JSON.stringify({ recipient_phone: validatePhone(input.phone), amount_kes: input.amountKes, currency: "KES", description: input.description.slice(0, 100), metadata: { match_id: input.matchId } }),
  });
  const allowed: CourtneyStatus[] = ["pending", "processing", "completed", "failed", "blocked", "unknown"];
  const raw = typeof data.status === "string" ? data.status.toLowerCase() : "unknown";
  return { status: allowed.includes(raw as CourtneyStatus) ? raw as CourtneyStatus : "unknown", ...(typeof data.requestId === "string" ? { requestId: data.requestId } : {}), ...(typeof data.transactionId === "string" ? { transactionId: data.transactionId } : {}) };
}

export const gatewayLimits = { minimumKes: AMOUNT_MIN, maximumKes: AMOUNT_MAX } as const;
