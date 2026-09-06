import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { issueReceipt, getReceipt } from "../../services/receiptService";
import { ValidationError } from "../../domain/errors";

const router = Router();

const issueReceiptSchema = z.object({
  obligationIds: z.array(z.string().uuid()).min(1),
  customerName: z.string().max(160).optional(),
  customerIdNumber: z.string().max(60).optional(),
  idempotencyKey: z.string().min(8),
});

/**
 * POST /receipts — BR-024: operational (non-fiscal) receipt.
 * Role: cajero/supervisor/admin (issued at the register, per 01_DISCOVERY.md).
 */
router.post("/", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const parsed = issueReceiptSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
    const output = await issueReceipt(req.user!.id, req.user!.tenantId, parsed.data);
    res.status(201).json(output);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const receipt = await getReceipt(req.user!.tenantId, req.params.id);
    if (!receipt) {
      res.status(404).json({ error: "RECEIPT_NOT_FOUND", message: "Receipt not found for tenant" });
      return;
    }
    res.status(200).json(receipt);
  } catch (err) {
    next(err);
  }
});

export default router;
