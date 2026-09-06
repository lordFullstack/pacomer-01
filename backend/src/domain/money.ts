import { ValidationError } from "./errors";

/**
 * Money is handled as integer cents internally to avoid float drift; string
 * decimals remain the wire format (03_DOMAIN_DATA_MODEL.md "Reglas": dinero
 * siempre decimal, nunca float).
 */
export function toCents(decimalString: string): number {
  if (decimalString.trim() === "") {
    throw new ValidationError("Amount cannot be an empty string");
  }
  const n = Number(decimalString);
  if (!Number.isFinite(n)) throw new ValidationError(`Invalid amount: ${decimalString}`);
  return Math.round(n * 100);
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
