import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { registerCredit, registerCreditRepayment, getCustomerAccountStatement } from "../../services/creditService";
import { ValidationError } from "../../domain/errors";

const router = Router();
const moneyString = z.string().regex(/^\d+(\.\d{1,2})?$/, "must be a decimal string like '12500.00'");

const customerSchema = z.union([
  z.object({ id: z.string().uuid() }),
  z.object({
    name: z.string().min(1).max(160),
    phone: z.string().min(5).max(30),
    type: z.enum(["persona", "empresa"]),
    creditLimit: moneyString,
  }),
]);

const registerCreditSchema = z.object({
  obligationIds: z.array(z.string().uuid()).min(1),
  customer: customerSchema,
  idempotencyKey: z.string().min(8),
});

/**
 * POST /credits — BR-014/BR-018: any cajero grants credit freely, subject
 * only to the customer's configured limit (BR-019, enforced in the service).
 */
router.post("/", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const parsed = registerCreditSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
    const output = await registerCredit(req.user!.id, req.user!.tenantId, parsed.data);
    res.status(201).json(output);
  } catch (err) {
    next(err);
  }
});

const repaymentSchema = z.object({
  tenders: z
    .array(z.object({ method: z.enum(["efectivo", "transferencia"]), amount: moneyString }))
    .min(1),
  idempotencyKey: z.string().min(8),
});

router.post("/:customerId/repayments", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const parsed = repaymentSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
    const output = await registerCreditRepayment(req.user!.id, req.user!.tenantId, {
      customerId: req.params.customerId,
      ...parsed.data,
    });
    res.status(201).json(output);
  } catch (err) {
    next(err);
  }
});

router.get("/:customerId", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const statement = await getCustomerAccountStatement(req.user!.tenantId, req.params.customerId);
    res.status(200).json(statement);
  } catch (err) {
    next(err);
  }
});

export default router;
