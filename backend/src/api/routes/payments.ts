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