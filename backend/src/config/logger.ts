import pino from "pino";
import { env } from "./env";

/**
 * LOOP 18 — Observabilidad.
 *
 * This is the raw substrate "Latencia API" / "Error rate" would be computed
 * from by a real monitoring tool (Grafana/Datadog/Supabase Logs) once one
 * is connected — this file does NOT claim to provide dashboards, alerting,
 * or "Disponibilidad" / "DB latency" / "Realtime delivery latency", which
 * require live infrastructure this environment doesn't have. Structured,
 * correlatable logs are the honest, buildable piece right now.
 *
 * Privacy rule (18_OBSERVABILITY.md: "No registrar más datos personales de
 * los necesarios"): request/response BODIES are never logged wholesale —
 * several routes carry a customer's name or cédula (LOOP 09, LOOP 11).
 * Only the fixed, reviewed fields below are ever written to a log line.
 */
export const logger = pino({
  level: env.nodeEnv === "test" ? "silent" : "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
});

/** The only fields httpLogger.ts is allowed to attach to a log line. */
export interface SafeRequestLogFields {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  tenantId?: string;
  userId?: string;
  role?: string;
}
