/**
 * Pure FIFO allocation logic, extracted so it can be unit-tested without a
 * database. Used by paymentService (obligations), creditService (customer
 * credits) and supplierService (purchases) — all three "apply money to a
 * list of debts, oldest/first-given first" flows share this exact algorithm.
 *
 * Contract: given ordered debts and a pool of money, apply as much as
 * possible to each debt in order (capped at its own remaining balance)
 * before moving to the next. Whatever money is left after every debt is
 * covered is returned as `leftoverCents` — callers decide what that means
 * (Change for payments/credit repayments; an error for supplier payments,
 * which must never be overpaid).
 */

export interface AllocationTarget {
  id: string;
  remainingCents: number;
}

export interface AllocationLine {
  id: string;
  appliedCents: number;
  remainingAfterCents: number;
}

export interface AllocationResult {
  allocations: AllocationLine[];
  appliedTotalCents: number;
  leftoverCents: number;
}

export function allocateFifo(targets: AllocationTarget[], poolCents: number): AllocationResult {
  if (poolCents < 0) throw new Error("poolCents must not be negative");

  let remainingPool = poolCents;
  const allocations: AllocationLine[] = [];

  for (const target of targets) {
    if (remainingPool <= 0) break;
    if (target.remainingCents <= 0) continue; // already settled, skip

    const applied = Math.min(remainingPool, target.remainingCents);
    remainingPool -= applied;
    allocations.push({
      id: target.id,
      appliedCents: applied,
      remainingAfterCents: target.remainingCents - applied,
    });
  }

  const appliedTotalCents = allocations.reduce((s, a) => s + a.appliedCents, 0);
  return { allocations, appliedTotalCents, leftoverCents: remainingPool };
}
