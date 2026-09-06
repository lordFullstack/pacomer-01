import { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";
import { logger } from "../config/logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Assigns a correlation ID to every request (visible to the client via the
 * X-Request-Id response header, and included in every error response —
 * see errorHandler.ts) and logs exactly the fields in SafeRequestLogFields.
 * Deliberately never logs req.body: several bodies in this API carry a
 * customer's name/cédula (LOOP 09/11) or financial amounts, and the
 * privacy rule in 18_OBSERVABILITY.md is "no más datos personales de los
 * necesarios" — a request log doesn't need any of that to be useful.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.info({
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      tenantId: req.user?.tenantId,
      userId: req.user?.id,
      role: req.user?.role,
    });
  });

  next();
}
