import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { openCashSession, closeCashSession } from "../../services/cashSessionService";
import { ValidationError } from "../../domain/errors";

const router = Router();
const moneyString = z.string().regex(/^\d+(\.\d{1,2})?$/, "must be a decimal string like '50000.00'");

const openSchema = z.object({ openingCash: moneyString });

router.post("/", authenticate, requireRole("cajero", "admin"), async (req, res, next) => {
  try {
    const parsed = openSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
    const session = await openCashSession(req.user!.id, req.user!.tenantId, parsed.data.openingCash);
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

const closeSchema = z.object({ countedCash: moneyString, observations: z.string().max(500).optional() });

router.post("/:id/close", authenticate, requireRole("cajero", "admin"), async (req, res, next) => {
  try {
    const parsed = closeSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join("; "));
    const session = await closeCashSession(
      req.user!.id,
      req.user!.tenantId,
      req.params.id,
      parsed.data.countedCash,
      parsed.data.observations
    );
    res.status(200).json(session);
  } catch (err) {
    next(err);
  }
});

export default router;
