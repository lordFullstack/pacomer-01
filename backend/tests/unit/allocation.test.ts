import { describe, it, expect } from "vitest";
import { allocateFifo } from "../../src/domain/allocation";

describe("allocateFifo — 08_PAYMENTS_CASH.md payment patterns", () => {
  it("individual: exact payment settles a single obligation with no leftover", () => {
    const result = allocateFifo([{ id: "ob-1", remainingCents: 3700 }], 3700);
    expect(result.allocations).toEqual([{ id: "ob-1", appliedCents: 3700, remainingAfterCents: 0 }]);
    expect(result.appliedTotalCents).toBe(3700);
    expect(result.leftoverCents).toBe(0);
  });

  it("cambio: overpayment leaves the excess as leftover (caller decides it's Change)", () => {
    // Bill $37.00, cash tendered $50.00 -> Change $13.00 (ADR-STACK §11 example)
    const result = allocateFifo([{ id: "ob-1", remainingCents: 3700 }], 5000);
    expect(result.allocations).toEqual([{ id: "ob-1", appliedCents: 3700, remainingAfterCents: 0 }]);
    expect(result.leftoverCents).toBe(1300);
  });

  it("pago parcial: tender less than the balance applies fully, obligation stays open", () => {
    const result = allocateFifo([{ id: "ob-1", remainingCents: 5000 }], 3000);
    expect(result.allocations).toEqual([{ id: "ob-1", appliedCents: 3000, remainingAfterCents: 2000 }]);
    expect(result.leftoverCents).toBe(0);
  });

  it("conjunto: one payer covers several obligations in the given order, oldest/first first", () => {
    const targets = [
      { id: "ob-1", remainingCents: 2000 },
      { id: "ob-2", remainingCents: 1500 },
      { id: "ob-3", remainingCents: 3000 },
    ];
    // Enough to fully cover ob-1 and ob-2, partially cover ob-3.
    const result = allocateFifo(targets, 4000);
    expect(result.allocations).toEqual([
      { id: "ob-1", appliedCents: 2000, remainingAfterCents: 0 },
      { id: "ob-2", appliedCents: 1500, remainingAfterCents: 0 },
      { id: "ob-3", appliedCents: 500, remainingAfterCents: 2500 },
    ]);
    expect(result.leftoverCents).toBe(0);
  });

  it("conjunto with change: covers all obligations fully and returns the excess as leftover", () => {
    const targets = [
      { id: "ob-1", remainingCents: 2000 },
      { id: "ob-2", remainingCents: 1500 },
    ];
    const result = allocateFifo(targets, 4000);
    expect(result.appliedTotalCents).toBe(3500);
    expect(result.leftoverCents).toBe(500);
  });

  it("skips already-settled targets (remainingCents <= 0) without erroring", () => {
    const targets = [
      { id: "ob-1", remainingCents: 0 },
      { id: "ob-2", remainingCents: 1000 },
    ];
    const result = allocateFifo(targets, 1000);
    expect(result.allocations).toEqual([{ id: "ob-2", appliedCents: 1000, remainingAfterCents: 0 }]);
  });

  it("zero-money pool applies nothing and returns zero leftover", () => {
    const result = allocateFifo([{ id: "ob-1", remainingCents: 1000 }], 0);
    expect(result.allocations).toEqual([]);
    expect(result.appliedTotalCents).toBe(0);
    expect(result.leftoverCents).toBe(0);
  });

  it("rejects a negative pool rather than silently misbehaving", () => {
    expect(() => allocateFifo([{ id: "ob-1", remainingCents: 1000 }], -100)).toThrow();
  });

  it("is order-sensitive: swapping target order changes which obligation absorbs the shortfall", () => {
    const forward = allocateFifo(
      [
        { id: "a", remainingCents: 1000 },
        { id: "b", remainingCents: 1000 },
      ],
      1500
    );
    const reversed = allocateFifo(
      [
        { id: "b", remainingCents: 1000 },
        { id: "a", remainingCents: 1000 },
      ],
      1500
    );
    expect(forward.allocations.find((a) => a.id === "a")?.remainingAfterCents).toBe(0);
    expect(forward.allocations.find((a) => a.id === "b")?.remainingAfterCents).toBe(500);
    expect(reversed.allocations.find((a) => a.id === "b")?.remainingAfterCents).toBe(0);
    expect(reversed.allocations.find((a) => a.id === "a")?.remainingAfterCents).toBe(500);
  });
});
