import { describe, expect, it } from "vitest";
import { formatIntegerAmount, formatKes } from "../../src/client/money-format.js";

describe("whole-KSh formatting", () => {
  it("formats values beyond Number.MAX_SAFE_INTEGER without precision loss", () => {
    const value = "9007199254740993";
    const expected = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(9007199254740993n);
    expect(formatIntegerAmount(value)).toBe(expected);
    expect(formatKes(value)).toBe(`KSh ${expected}`);
  });

  it("rejects non-integer and unsafe numeric inputs rather than rounding money", () => {
    expect(formatIntegerAmount("1.25")).toBe("—");
    expect(formatIntegerAmount(Number.MAX_SAFE_INTEGER + 1)).toBe("—");
    expect(formatIntegerAmount("-10")).toBe(new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(-10n));
  });
});
