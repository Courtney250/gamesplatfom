export const LIVE_MONEY_WORKFLOWS_READY = false;
export function isRealMoneyEnabled(): boolean {
  return process.env.REAL_MONEY_ENABLED === "true" && LIVE_MONEY_WORKFLOWS_READY;
}
export const PAYMENT_MODE = process.env.PAYMENT_MODE === "courtneytech" && isRealMoneyEnabled()
  ? "courtneytech"
  : "simulation";
export const DEFAULT_SERVICE_FEE_BPS = 1_000;
export const MATCH_TIMEOUT_MS = 90_000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function assertRealMoneyEnabled(): void {
  if (!isRealMoneyEnabled()) {
    throw Object.assign(new Error("Real-money features are disabled until required approvals and controls are confirmed."), {
      status: 403,
      code: "REAL_MONEY_DISABLED",
    });
  }
}
