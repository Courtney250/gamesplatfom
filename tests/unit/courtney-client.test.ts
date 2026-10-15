import { afterEach, describe, expect, it, vi } from "vitest";
import { getStkStatus, initiateStk, requestWinnerPayout } from "../../src/server/payments/courtneytech/client.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Courtney Tech local API adapter", () => {
  it("does not call the gateway while live workflows are not launch-approved, even if env flags are set", async () => {
    vi.stubEnv("REAL_MONEY_ENABLED", "true");
    vi.stubEnv("COURTNEY_PAYOUTS_ENABLED", "true");
    vi.stubEnv("B2CCOURTNEY_API_KEY", "test-key");
    vi.stubEnv("B2CCOURTNEY_API_SECRET", "test-secret");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(initiateStk({ phone: "+254712345678", amountKes: 1, reference: "MATCH123", description: "DuelKe entry", idempotencyKey: "match_12345678" })).rejects.toMatchObject({ code: "REAL_MONEY_DISABLED" });
    await expect(getStkStatus("match_12345678")).rejects.toMatchObject({ code: "REAL_MONEY_DISABLED" });
    await expect(requestWinnerPayout({ phone: "+254712345678", amountKes: 1, description: "Winner", matchId: "match_12345678", idempotencyKey: "payout_12345678" })).rejects.toMatchObject({ code: "REAL_MONEY_DISABLED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

});
