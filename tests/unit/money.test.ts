import { describe, expect, it } from "vitest";
import { calculateMatchEconomics, feeForPool, parseKes } from "../../src/shared/money.js";

describe("integer KSh and match economics", () => {
  it("computes a KSh 200 pool, KSh 20 fee and KSh 180 winner payout", () => {
    expect(calculateMatchEconomics(100n)).toEqual({
      stakePerPlayerKes: 100n,
      prizePoolKes: 200n,
      feeBps: 1_000,
      platformFeeKes: 20n,
      winnerPayoutKes: 180n,
    });
  });
  it("uses integer arithmetic and rounds fractional shillings down", () => {
    expect(feeForPool(199n, 1_000)).toBe(19n);
  });
  it("rejects decimal, negative, non-numeric and out-of-range amounts", () => {
    expect(() => parseKes("1.5")).toThrow();
    expect(() => parseKes("-1")).toThrow();
    expect(() => parseKes("1e3")).toThrow();
    expect(() => parseKes("70001", { max: 70_000n })).toThrow();
  });
});
