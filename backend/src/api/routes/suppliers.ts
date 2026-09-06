import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { registerPurchase, registerSupplierPayment, getSupplierAccountStatement } from "../../services/supplierService";
import { ValidationError } from "../../domain/errors";

const router = Router();
const moneyString = z.string().regex(/^\d+(\.\d{1,2})?$/, "must be a decimal string like '80000.00'");

const supplierSchema = z.union([
  z.object({ id: z.string().uuid() }),
  z.object({ name: z.string().min(1).max(160), paymentTerms: z.enum(["contado", "semanal", "quincenal"]) }),
]);

const registerPurchaseSchema = z.object({
  supplier: supplierSchema,
  amount: moneyString,
  idempotencyKey: z.string().min(8),
});

/**
 * POST /suppliers/purchases — BR-021: adds to the supplier's single
 * accumulated balance. Role: cajero/supervisor/admin — registering a
 * purchase is a cash-adjacent operation, not a servidor concern.
 */
router.post("/purchases", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const parsed = registerPurchaseSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
    const output = await registerPurchase(req.user!.id, req.user!.tenantId, parsed.data);
    res.status(201).json(output);
  } catch (err) {
    next(err);
  }
});

const paymentSchema = z.object({
  tenders: z
    .array(z.object({ method: z.enum(["efectivo", "transferencia"]), amount: moneyString }))
    .min(1),
  idempotencyKey: z.string().min(8),
});

router.post("/:supplierId/payments", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
    const output = await registerSupplierPayment(req.user!.id, req.user!.tenantId, {
      supplierId: req.params.supplierId,
      ...parsed.data,
    });
    res.status(201).json(output);
  } catch (err) {
    next(err);
  }
});

router.get("/:supplierId", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const statement = await getSupplierAccountStatement(req.user!.tenantId, req.params.supplierId);
    res.status(200).json(statement);
  } catch (err) {
    next(err);
  }
});

export default router;
