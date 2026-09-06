import { NextFunction, Request, Response } from "express";
import { DomainError } from "../domain/errors";
import { logger } from "../config/logger";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof DomainError) {
    res.status(err.httpStatus).json({ error: err.code, message: err.message, requestId: req.requestId });
    return;
  }

  if (err instanceof Error && err.message === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD") {
    res.status(409).json({
      error: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
      message: "This idempotency key was already used with a different request body.",
      requestId: req.requestId,
    });
    return;
  }

  // Full error detail goes server-side only, keyed by requestId — never in
  // the client-facing response (see the generic message below).
  logger.error({ requestId: req.requestId, err }, "unhandled_error");
  res.status(500).json({
    error: "INTERNAL_ERROR",
    message: "Unexpected server error",
    requestId: req.requestId,
  });
}
