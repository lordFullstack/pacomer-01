import { NextFunction, Request, Response } from "express";
import { supabase } from "../config/supabaseClient";
import { UnauthorizedError } from "../domain/errors";

/**
 * 13_SECURITY_ROLES.md: "No confiar en el frontend para permisos. Toda
 * autorización crítica en backend." This middleware only establishes WHO is
 * calling (identity via Supabase Auth). WHAT they're allowed to do is
 * resolved separately by requireRole() against roles stored in Postgres —
 * never trusted from the JWT claims alone beyond identity.
 */
export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  role: "servidor" | "cajero" | "supervisor" | "admin";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing bearer token");
    }
    const token = header.slice("Bearer ".length);

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedError("Invalid or expired token");
    }

    // tenant_id and role are read from our own app_users table (source of
    // truth for authorization), not from JWT app_metadata, so that role
    // changes take effect immediately without reissuing tokens.
    const { data: appUser, error: appUserError } = await supabase
      .from("app_users")
      .select("tenant_id, role")
      .eq("auth_user_id", data.user.id)
      .single();

    if (appUserError || !appUser) {
      throw new UnauthorizedError("User is not provisioned for any tenant");
    }

    req.user = {
      id: data.user.id,
      tenantId: appUser.tenant_id,
      role: appUser.role,
    };
    next();
  } catch (err) {
    next(err);
  }
}
