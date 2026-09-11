import React, { useState, useEffect, useCallback } from "react";
import { Session } from "../types";
import { apiFetch, genIdempotencyKey, money } from "../lib/api";
import { colors, btnPrimary } from "../lib/theme";

interface PendingObligation {
  obligationId: string;
  tableLabel: string;
  dinerName: string | null;
  remaining: string;
}

/**
 * LOOP 07 — Frontend Cajero.
 * 07_FRONTEND_CASHIER.md: cola de pendientes, cobro individual/conjunto,
 * efectivo/transferencia/mixto con cambio calculado por el backend (nunca
 * por el frontend — ADR-STACK §18). Talks to the real /reports/* and
 * /payments/* + /cash-sessions endpoints.
 */
export default function CashierScreen({ session }: { session: Session }) {
  const [pending, setPending] = useState<PendingObligation[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cashStatus, setCashStatus] = useState<{ status: string; expectedCash: string | null } | null>(null);
  const [openingCash, setOpeningCash] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cashInput, setCashInput] = useState("");
  const [transferInput, setTransferInput] = useState("");
  const [ticket, setTicket] = useState<{ text: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [pend, cash] = await Promise.all([
        apiFetch(session, "/reports/pending-collections"),
        apiFetch(session, "/reports/cash-status"),
      ]);
      setPending(pend.obligations);
      setCashStatus(cash);
    } catch {
      /* transient errors during polling are fine to ignore */
    }
  }, [session]);

  useEffect(() => {
    refresh();
    // Polling until Supabase Realtime is wired (ADR-STACK §7-9 scope) —
    // this is a known, stated stand-in, not the final architecture.
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const selectedObligations = pending.filter((o) => selected.has(o.obligationId));
  const selectedRemaining = selectedObligations.reduce((s, o) => s + Number(o.remaining), 0);
  const cashCents = Number(cashInput || 0);
  const transferCents = Number(transferInput || 0);
  const change = Math.max(0, cashCents + transferCents - selectedRemaining);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openCashSession = async () => {
    setLoading(true);
    try {
      await apiFetch(session, "/cash-sessions", { method: "POST", body: JSON.stringify({ openingCash: openingCash || "0.00" }) });
      await refresh();
    } catch (e: unknown) {
      setTicket({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
    }
  };

  const confirmPayment = async () => {
    setLoading(true);
    try {
      const tenders = [];
      if (cashCents > 0) tenders.push({ method: "efectivo", amount: cashInput });
      if (transferCents > 0) tenders.push({ method: "transferencia", amount: transferInput });
      const out = await apiFetch(session, "/payments", {
        method: "POST",
        body: JSON.stringify({ obligationIds: [...selected], tenders, idempotencyKey: genIdempotencyKey() }),
      });
      setTicket({
        ok: true,
        text: `Cobrado ${money(out.appliedAmount)}${Number(out.changeAmount) > 0 ? ` · cambio ${money(out.changeAmount)}` : ""}`,
      });
      setSelected(new Set());
      setDrawerOpen(false);
      setCashInput("");
      setTransferInput("");
      await refresh();
    } catch (e: unknown) {
      setTicket({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
      setTimeout(() => setTicket(null), 2500);
    }
  };

  const noSession = !cashStatus || cashStatus.status === "NO_SESSION";

  return (
    <div style={{ padding: 20, maxWidth: 480, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, fontSize: 13 }}>
        <div>
          Caja: <strong style={{ color: noSession ? colors.dangerText : colors.success }}>{noSession ? "SIN ABRIR" : cashStatus!.status}</strong>
          {cashStatus?.expectedCash && <span style={{ color: colors.textMuted, marginLeft: 8 }}>esperado {money(cashStatus.expectedCash)}</span>}
        </div>
      </div>

      {noSession && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.surface }}>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 6 }}>Abrir caja con base inicial</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="0.00"
              style={{ flex: 1, padding: 8, borderRadius: 6, background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
            />
            <button onClick={openCashSession} disabled={loading} style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: colors.accent, color: colors.bg, fontWeight: 700 }}>
              Abrir
            </button>
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>PENDIENTES ({pending.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {pending.map((o) => (
          <button
            key={o.obligationId}
            onClick={() => toggle(o.obligationId)}
            style={{
              textAlign: "left",
              padding: 12,
              borderRadius: 10,
              border: selected.has(o.obligationId) ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
              background: selected.has(o.obligationId) ? "#332A1C" : colors.surface,
              color: colors.text,
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
              <span>
                {o.tableLabel}
                {o.dinerName ? ` · ${o.dinerName}` : ""}
              </span>
              <span>{money(o.remaining)}</span>
            </div>
          </button>
        ))}
        {pending.length === 0 && <div style={{ color: colors.textDim, fontSize: 13 }}>Sin pendientes.</div>}
      </div>

      {selected.size > 0 && (
        <button
          onClick={() => {
            setCashInput(selectedRemaining.toString());
            setDrawerOpen(true);
          }}
          style={{ ...btnPrimary, width: "100%", marginBottom: 14 }}
        >
          COBRAR · {money(selectedRemaining)}
        </button>
      )}

      {drawerOpen && (
        <div style={{ padding: 16, borderRadius: 12, border: `1px solid ${colors.border}`, background: colors.surface, marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4 }}>EFECTIVO</div>
          <input
            value={cashInput}
            onChange={(e) => setCashInput(e.target.value.replace(/[^\d.]/g, ""))}
            style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, marginBottom: 10, fontWeight: 800, fontSize: 18 }}
          />
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4 }}>TRANSFERENCIA</div>
          <input
            value={transferInput}
            onChange={(e) => setTransferInput(e.target.value.replace(/[^\d.]/g, ""))}
            style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, marginBottom: 10, fontWeight: 800, fontSize: 18 }}
          />
          <div style={{ fontSize: 13, color: colors.success, marginBottom: 10 }}>Cambio: {money(change)}</div>
          <button onClick={confirmPayment} disabled={loading} style={{ width: "100%", padding: 12, borderRadius: 8, border: "none", background: colors.accent, color: colors.bg, fontWeight: 800 }}>
            {loading ? "PROCESANDO…" : "CONFIRMAR"}
          </button>
        </div>
      )}

      {ticket && (
        <div style={{ padding: 10, borderRadius: 8, background: ticket.ok ? "#1E2A1D" : "#2A1D1A", color: ticket.ok ? colors.success : colors.dangerText, fontSize: 13 }}>
          {ticket.text}
        </div>
      )}
    </div>
  );
}
