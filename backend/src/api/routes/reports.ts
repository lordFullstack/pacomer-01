import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import {
  getDailySalesReport,
  getPendingCollectionsReport,
  getCustomerCreditsReport,
  getCashStatusReport,
  getPayablesReport,
} from "../../services/reportService";

const router = Router();

// All report endpoints: cajero/supervisor/admin can view (dashboard is
// primarily for the owner, but a cajero benefits from seeing pendientes/
// cuadre during the shift too — 12_REPORTS.md doesn't restrict viewers).
router.get("/daily-sales", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    res.json(await getDailySalesReport(req.user!.tenantId, date));
  } catch (err) {
    next(err);
  }
});

router.get("/pending-collections", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    res.json(await getPendingCollectionsReport(req.user!.tenantId));
  } catch (err) {
    next(err);
  }
});

router.get("/customer-credits", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    res.json(await getCustomerCreditsReport(req.user!.tenantId));
  } catch (err) {
    next(err);
  }
});

router.get("/cash-status", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    res.json(await getCashStatusReport(req.user!.tenantId));
  } catch (err) {
    next(err);
  }
});

router.get("/payables", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    res.json(await getPayablesReport(req.user!.tenantId));
  } catch (err) {
    next(err);
  }
});

// "Próximos vencimientos" intentionally not implemented — depends on due
// dates, and BR-020/BR-022 already decided neither customer credit nor
// supplier balances carry one in this version.

export default router;
