import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { pool } from "../../db/pool";

const router = Router();

/**
 * GET /tables — lists all of the tenant's tables. Read-only, no locking,
 * same posture as LOOP 12 reports (12_REPORTS.md: never touch the critical
 * path). Added because ServerScreen (LOOP 06) previously had no way to see
 * a table that has nothing pending yet — it was inferring the table list
 * from /reports/pending-collections, which only ever shows tables that
 * already have an open obligation. A freshly seeded table (BR: 14 mesas
 * confirmed in 01_DISCOVERY.md) was invisible until someone registered a
 * diner there by pasting its UUID manually.
 */
router.get("/", authenticate, async (req, res, next) => {
  try {
    const result = await pool.query<{ id: string; label: string }>(
      `SELECT id, label FROM tables
       WHERE tenant_id = $1
       ORDER BY NULLIF(regexp_replace(label, '[^0-9]', '', 'g'), '')::int NULLS LAST, label`,
      [req.user!.tenantId]
    );
    res.json({ tables: result.rows });
  } catch (err) {
    next(err);
  }
});

export default router;
