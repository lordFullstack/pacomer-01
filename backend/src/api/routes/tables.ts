import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { pool, withTransaction } from "../../db/pool";
import { TableNotFoundError, TableSessionNotOpenError } from "../../domain/errors";

const router = Router();

/**
 * GET /tables — lists all of the tenant's tables, plus a live summary of
 * whichever ones currently have an OPEN table_session (BR-002/BR-003: at
 * most one OPEN session per table). Powers both ServerScreen's mesa grid
 * (just needs hasOpenAccount, to color a table green) and CashierScreen's
 * mesa grid (also needs total/dinerCount/openedAt for the occupied-table
 * summary card). Read-only, no locking — same posture as LOOP 12 reports.
 */
router.get("/", authenticate, async (req, res, next) => {
  try {
    const result = await pool.query<{
      id: string;
      label: string;
      has_open_account: boolean;
      diner_count: string | null;
      total_cents: string | null;
      opened_at: string | null;
    }>(
      `SELECT
          t.id, t.label,
          ts.id IS NOT NULL AS has_open_account,
          (SELECT count(*) FROM diners d WHERE d.table_session_id = ts.id) AS diner_count,
          (SELECT coalesce(sum(
                    (po.amount * 100)::bigint
                      - coalesce((
                          SELECT sum(pa.amount * 100)::bigint FROM payment_allocations pa
                          JOIN payments p ON p.id = pa.payment_id
                          WHERE pa.obligation_id = po.id AND p.status = 'ACTIVE'
                        ), 0)
                      - coalesce((SELECT sum(cc.amount * 100)::bigint FROM customer_credits cc WHERE cc.obligation_id = po.id), 0)
                  ), 0)::bigint
             FROM payment_obligations po
             JOIN diners d ON d.id = po.diner_id
             WHERE d.table_session_id = ts.id) AS total_cents,
          ts.opened_at
       FROM tables t
       LEFT JOIN table_sessions ts ON ts.table_id = t.id AND ts.tenant_id = t.tenant_id AND ts.status = 'OPEN'
       WHERE t.tenant_id = $1
       ORDER BY NULLIF(regexp_replace(t.label, '[^0-9]', '', 'g'), '')::int NULLS LAST, t.label`,
      [req.user!.tenantId]
    );
    res.json({
      tables: result.rows.map((r) => ({
        id: r.id,
        label: r.label,
        hasOpenAccount: r.has_open_account,
        dinerCount: r.has_open_account ? Number(r.diner_count) : 0,
        total: r.has_open_account ? (Number(r.total_cents) / 100).toFixed(2) : "0.00",
        openedAt: r.has_open_account ? r.opened_at : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /tables/:id/session — the open session's diners, for the cashier's
 * per-table detail panel (each diner's own obligation, so it can be
 * charged or fiado individually). Mirrors the same remaining-balance math
 * as reportService.getPendingCollectionsReport, just scoped to one table
 * and including already-settled diners so the panel can show them too.
 */
router.get("/:id/session", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    const table = await pool.query<{ id: string; label: string }>(
      `SELECT id, label FROM tables WHERE tenant_id = $1 AND id = $2`,
      [req.user!.tenantId, req.params.id]
    );
    if (table.rowCount === 0) throw new TableNotFoundError(req.params.id);

    const session = await pool.query<{ id: string; opened_at: string }>(
      `SELECT id, opened_at FROM table_sessions
       WHERE tenant_id = $1 AND table_id = $2 AND status = 'OPEN'`,
      [req.user!.tenantId, req.params.id]
    );
    if (session.rowCount === 0) {
      res.json({ tableId: table.rows[0].id, tableLabel: table.rows[0].label, openedAt: null, diners: [] });
      return;
    }
    const tableSessionId = session.rows[0].id;

    const diners = await pool.query<{
      diner_id: string;
      obligation_id: string;
      name: string | null;
      descriptor: string | null;
      amount: string;
      status: string;
      remaining_cents: string;
      created_at: string;
    }>(
      `SELECT
          d.id AS diner_id, po.id AS obligation_id, d.name, d.descriptor, d.created_at,
          po.amount, po.status,
          (po.amount * 100)::bigint
            - coalesce((
                SELECT sum(pa.amount * 100)::bigint FROM payment_allocations pa
                JOIN payments p ON p.id = pa.payment_id
                WHERE pa.obligation_id = po.id AND p.status = 'ACTIVE'
              ), 0)
            - coalesce((SELECT sum(cc.amount * 100)::bigint FROM customer_credits cc WHERE cc.obligation_id = po.id), 0)
            AS remaining_cents
       FROM diners d
       JOIN payment_obligations po ON po.diner_id = d.id
       WHERE d.table_session_id = $1
       ORDER BY d.created_at ASC`,
      [tableSessionId]
    );

    res.json({
      tableId: table.rows[0].id,
      tableLabel: table.rows[0].label,
      openedAt: session.rows[0].opened_at,
      diners: diners.rows.map((r) => ({
        dinerId: r.diner_id,
        obligationId: r.obligation_id,
        name: r.name,
        descriptor: r.descriptor,
        amount: r.amount,
        status: r.status,
        remaining: (Number(r.remaining_cents) / 100).toFixed(2),
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /tables/:id/release — closes the table's OPEN session so it goes
 * back to "Libre" on the mesa grid. Used both for "Liberar sin cobrar"
 * (called directly — any still-pending obligations stay pending, just no
 * longer tied to an occupied table) and right after "Cobrar todo" settles
 * every obligation. No session ever closed itself before this; leaving
 * balances untouched on release is a deliberate simplification for this
 * loop, not an accounting write-off.
 */
router.post("/:id/release", authenticate, requireRole("cajero", "supervisor", "admin"), async (req, res, next) => {
  try {
    await withTransaction(async (client) => {
      const table = await client.query(`SELECT id FROM tables WHERE tenant_id = $1 AND id = $2`, [
        req.user!.tenantId,
        req.params.id,
      ]);
      if (table.rowCount === 0) throw new TableNotFoundError(req.params.id);

      const closed = await client.query(
        `UPDATE table_sessions SET status = 'CLOSED', closed_at = now()
         WHERE tenant_id = $1 AND table_id = $2 AND status = 'OPEN'
         RETURNING id`,
        [req.user!.tenantId, req.params.id]
      );
      if (closed.rowCount === 0) throw new TableSessionNotOpenError(req.params.id);
    });
    res.status(200).json({ released: true });
  } catch (err) {
    next(err);
  }
});

export default router;
