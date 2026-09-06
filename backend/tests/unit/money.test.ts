import { describe, it, expect } from "vitest";
import { toCents, fromCents } from "../../src/domain/money";

describe("money (cents-based arithmetic)", () => {
  it("converts a plain decimal string to integer cents", () => {
    expect(toCents("100.00")).toBe(10000);
    expect(toCents("12500.50")).toBe(1250050);
  });

  it("rounds to the nearest cent for inputs with floating imprecision", () => {
    // classic float trap: 0.1 + 0.2 !== 0.3 in IEEE754 — must not leak through.
    expect(toCents("0.1")).toBe(10);
    expect(toCents("19.99")).toBe(1999);
  });

  it("round-trips cents back to a two-decimal string", () => {
    expect(fromCents(10000)).toBe("100.00");
    expect(fromCents(1)).toBe("0.01");
    expect(fromCents(0)).toBe("0.00");
  });

  it("throws on non-numeric input rather than silently producing NaN/0", () => {
    expect(() => toCents("not-a-number")).toThrow();
    expect(() => toCents("")).toThrow();
  });
});
