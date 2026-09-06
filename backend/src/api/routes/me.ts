import { Router } from "express";
import { authenticate } from "../../middleware/auth";

const router = Router();

/**
 * GET /me — introspection endpoint so the frontend can decide which screen
 * to show (servidor vs cajero/supervisor/admin) without the client having
 * to know or guess the logged-in user's role. Added when wiring the real
 * UI to the backend for the first time — no prior loop needed it because
 * every test so far set the role directly in a mock.
 */
router.get("/", authenticate, (req, res) => {
  res.json({ userId: req.user!.id, tenantId: req.user!.tenantId, role: req.user!.role });
});

export default router;
