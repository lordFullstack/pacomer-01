import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
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
 * POST /payments — 08_PAYMENTS_CASH.md. Role: cajero or admin (a servidor
 * has no reason to touch money, per least-privilege in 13_SECURITY_ROLES.md).
 */
router.post("/", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const parsed = registerPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
    }

    // BR-014: reject credit here with a clear pointer, rather than silently
    // accepting it — credit has its own lifecycle owned by LOOP 09.
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
 * shortcut evaluated server-side: if the requester is the payment's own
 * creator and it's within the self-void window, this executes immediately
 * (202 body will show status SELF_EXECUTED). Otherwise it creates a
 * PENDING_AUTHORIZATION request for a supervisor/admin to resolve below.
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
 * BR-017: 'admin' (owner) or a designated 'supervisor' may authorize.
 * Authorizing executes the reversal immediately.
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
