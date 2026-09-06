import { NextFunction, Request, Response } from "express";
import { AuthenticatedUser } from "./auth";
import { ForbiddenError, UnauthorizedError } from "../domain/errors";

/**
 * 13_SECURITY_ROLES.md — least privilege. Which exact operations each role
 * may perform beyond this endpoint (e.g. what a cajero can anular without
 * owner authorization) is still an OPEN item per that loop and must not be
 * invented here; this only gates route-level access.
 */
export function requireRole(...allowed: Array<AuthenticatedUser["role"]>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (!allowed.includes(req.user.role)) {
      next(new ForbiddenError(`Role '${req.user.role}' cannot perform this action`));
      return;
    }
    next();
  };
}
