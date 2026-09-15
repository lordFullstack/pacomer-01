import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { registerDiner } from "../../services/dinerService";
import { ValidationError } from "../../domain/errors";

const router = Router();

const registerDinerSchema = z.object({
  tableId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "amount must be a decimal string like '12500.00'"),
  paymentMode: z.enum(["individual", "conjunto"]),
  name: z.string().max(120).optional(),
  descriptor: z.string().max(120).optional(),
  idempotencyKey: z.string().min(8),
});

/**
 * POST /service-line/diners
 * 05_BACKEND.md priority endpoint. 'servidor' registers diners from the
 * floor; 'cajero'/'supervisor' may also open a table or add a diner
 * directly from the register (CashierScreen's "+ Agregar persona"), same
 * as they can already collect payment for one — 'admin' as always.
 */
router.post(
  "/diners",
  authenticate,
  requireRole("servidor", "cajero", "supervisor", "admin"),
  async (req, res, next) => {
    try {
      const parsed = registerDinerSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
      }
      const output = await registerDiner(req.user!.id, req.user!.tenantId, parsed.data);
      res.status(201).json(output);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
