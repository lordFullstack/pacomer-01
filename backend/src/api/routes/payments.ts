import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { pool } from "../../db/pool";
import { requireRole } from "../../middleware/requireRole";
import { registerPayment } from "../../services/paymentService";
import { requestVoid, authorizeVoid } from "../../services/voidService";
import { ValidationError, CreditNotAllowedOnPaymentsError } from "../../domain/errors";

const router = Router();

const moneyString = z.string().regex(/^\d+(\.\d{1,2})?$/, "must be a decimal string like '12500.00'");

const registerPaymentSchema = z.object({
  obligationIds: z.array(z.string().uuid()).min(1),
  tenders: z
    .array(
      z.object({
        method: z.enum(["efectivo", "transferencia", "credito"]),
        amount: moneyString,
      })
    )
    .min(1),
  idempotencyKey: z.string().min(8),
});

/**
 * GET /payments/recent — read-only, same posture as LOOP 12 reports.
 * Feeds the cashier's "cobros recientes" panel so void/self-void has
 * something real to act on (previously only existed in-memory in a UI
 * prototype, never backed by an actual endpoint).
 */
router.get("/recent", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
          p.id, p.status, p.amount AS applied_amount, p.created_by_user_id, p.created_at,
          coalesce(c.amount, 0) AS change_amount,
          array_agg(DISTINCT t.label) AS table_labels
       FROM payments p
       LEFT JOIN changes c ON c.payment_id = p.id
       JOIN payment_allocations pa ON pa.payment_id = p.id
       JOIN payment_obligations po ON po.id = pa.obligation_id
       JOIN diners d ON d.id = po.diner_id
       JOIN table_sessions ts ON ts.id = d.table_session_id
       JOIN tables t ON t.id = ts.table_id
       WHERE p.tenant_id = $1
       GROUP BY p.id, c.amount
       ORDER BY p.created_at DESC
       LIMIT 10`,
      [req.user!.tenantId]
    );
    res.json({ payments: result.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /payments/log?date=YYYY-MM-DD — full payment log for one day (default
 * today), each with its latest void request if any. Feeds the "Logs de
 * anulaciones" section in Reportes (grouped by mesa/día client-side) — the
 * single place cajero/supervisor/admin now request or authorize a void,
 * replacing the old inline "Cobros recientes" anular buttons.
 */
router.get("/log", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const date = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);
    const result = await pool.query(
      `SELECT
          p.id, p.status, p.amount AS applied_amount, p.created_by_user_id, p.created_at,
          coalesce(c.amount, 0) AS change_amount,
          array_agg(DISTINCT t.label) AS table_labels,
          vr.id AS void_request_id, vr.status AS void_status, vr.reason AS void_reason,
          vr.requested_by_user_id AS void_requested_by, vr.authorized_by_user_id AS void_authorized_by,
          vr.requested_at AS void_requested_at, vr.resolved_at AS void_resolved_at
       FROM payments p
       LEFT JOIN changes c ON c.payment_id = p.id
       JOIN payment_allocations pa ON pa.payment_id = p.id
       JOIN payment_obligations po ON po.id = pa.obligation_id
       JOIN diners d ON d.id = po.diner_id
       JOIN table_sessions ts ON ts.id = d.table_session_id
       JOIN tables t ON t.id = ts.table_id
       LEFT JOIN LATERAL (
         SELECT * FROM payment_void_requests
         WHERE payment_id = p.id
         ORDER BY requested_at DESC
         LIMIT 1
       ) vr ON true
       WHERE p.tenant_id = $1 AND p.created_at::date = $2::date
       GROUP BY p.id, c.amount, vr.id, vr.status, vr.reason, vr.requested_by_user_id,
                vr.authorized_by_user_id, vr.requested_at, vr.resolved_at
       ORDER BY p.created_at DESC`,
      [req.user!.tenantId, date]
    );
    res.json({
      date,
      payments: result.rows.map((r) => ({
        id: r.id,
        status: r.status,
        applied_amount: r.applied_amount,
        change_amount: r.change_amount,
        created_by_user_id: r.created_by_user_id,
        created_at: r.created_at,
        table_labels: r.table_labels,
        voidRequest: r.void_request_id
          ? {
              id: r.void_request_id,
              status: r.void_status,
              reason: r.void_reason,
              requestedByUserId: r.void_requested_by,
              authorizedByUserId: r.void_authorized_by,
              requestedAt: r.void_requested_at,
              resolvedAt: r.void_resolved_at,
            }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /payments/void-requests/pending — feeds the supervisor/admin
 * authorization panel (BR-017).
 */
router.get(
  "/void-requests/pending",
  authenticate,
  requireRole("supervisor", "admin"),
  async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT vr.id, vr.payment_id, vr.reason, vr.requested_at,
                p.amount AS applied_amount
         FROM payment_void_requests vr
         JOIN payments p ON p.id = vr.payment_id
         WHERE vr.tenant_id = $1 AND vr.status = 'PENDING_AUTHORIZATION'
         ORDER BY vr.requested_at ASC`,
        [req.user!.tenantId]
      );
      res.json({ requests: result.rows });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /payments — 08_PAYMENTS_CASH.md. Role: cajero, supervisor, or admin.
 */
router.post("/", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const parsed = registerPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
    }

    if (parsed.data.tenders.some((t) => t.method === "credito")) {
      throw new CreditNotAllowedOnPaymentsError();
    }

    const output = await registerPayment(req.user!.id, req.user!.tenantId, {
      ...parsed.data,
      tenders: parsed.data.tenders as Array<{ method: "efectivo" | "transferencia"; amount: string }>,
    });
    res.status(201).json(output);
  } catch (err) {
    next(err);
  }
});

const voidRequestSchema = z.object({ reason: z.string().min(3) });

/**
 * POST /payments/:id/void — Step 1 of BR-015, with the BR-016 self-void
 * shortcut evaluated server-side.
 */
router.post("/:id/void", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const parsed = voidRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const result = await requestVoid(req.user!.id, req.user!.tenantId, req.params.id, parsed.data.reason);
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
});

const authorizeSchema = z.object({ decision: z.enum(["AUTHORIZED", "DENIED"]) });

/**
 * POST /payments/void-requests/:id/authorize — Step 2 of BR-015.
 * BR-017: 'admin' or 'supervisor' may authorize.
 */
router.post(
  "/void-requests/:id/authorize",
  authenticate,
  requireRole("admin", "supervisor"),
  async (req, res, next) => {
    try {
      const parsed = authorizeSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
      }
      const result = await authorizeVoid(req.user!.id, req.user!.tenantId, req.params.id, parsed.data.decision);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;