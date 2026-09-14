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

interface RecentPayment {
  id: string;
  status: "ACTIVE" | "VOIDED";
  applied_amount: string;
  change_amount: string;
  created_by_user_id: string;
  created_at: string;
  table_labels: string[];
}

interface PendingVoidRequest {
  id: string;
  payment_id: string;
  reason: string;
  applied_amount: string;
  requested_at: string;
}

interface CashStatus {
  sessionId: string | null;
  status: string;
  expectedCash: string | null;
}

const SELF_VOID_WINDOW_SECONDS = 120;

export default function CashierScreen({ session }: { session: Session }) {
  const [pending, setPending] = useState<PendingObligation[]>([]);
  const [recentPayments, setRecentPayments] = useState<RecentPayment[]>([]);
  const [pendingVoidRequests, setPendingVoidRequests] = useState<PendingVoidRequest[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cashStatus, setCashStatus] = useState<CashStatus | null>(null);
  const [openingCash, setOpeningCash] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cashInput, setCashInput] = useState("");
  const [transferInput, setTransferInput] = useState("");
  const [voidReasonFor, setVoidReasonFor] = useState<string | null>(null);
  const [voidReasonText, setVoidReasonText] = useState("");
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [ticket, setTicket] = useState<{ text: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [, forceTick] = useState(0);

  const canAuthorize = session.role === "supervisor" || session.role === "admin";

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const calls = [
        apiFetch(session, "/reports/pending-collections"),
        apiFetch(session, "/reports/cash-status"),
        apiFetch(session, "/payments/recent"),
      ];
      if (canAuthorize) calls.push(apiFetch(session, "/payments/void-requests/pending"));

      const results = await Promise.all(calls);
      setPending(results[0].obligations);
      setCashStatus(results[1]);
      setRecentPayments(results[2].payments);
      if (canAuthorize) setPendingVoidRequests(results[3].requests);
    } catch {
      /* transient errors during polling are fine to ignore */
    }
  }, [session, canAuthorize]);

  useEffect(() => {
    refresh();
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

  const closeCashSession = async () => {
    if (!cashStatus?.sessionId) return;
    setLoading(true);
    try {
      const out = await apiFetch(session, `/cash-sessions/${cashStatus.sessionId}/close`, {
        method: "POST",
        body: JSON.stringify({ countedCash: countedCash || "0.00" }),
      });
      setTicket({ ok: true, text: `Caja cerrada. Diferencia: ${money(out.difference)}` });
      setCloseModalOpen(false);
      setCountedCash("");
      await refresh();
    } catch (e: unknown) {
      setTicket({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
      setTimeout(() => setTicket(null), 3000);
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

  const secondsSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 1000;

  const canSelfVoid = (p: RecentPayment) =>
    p.status === "ACTIVE" && p.created_by_user_id === session.userId && secondsSince(p.created_at) <= SELF_VOID_WINDOW_SECONDS;

  const executeSelfVoid = async (paymentId: string) => {
    setLoading(true);
    try {
      await apiFetch(session, `/payments/${paymentId}/void`, {
        method: "POST",
        body: JSON.stringify({ reason: "Auto-anulación dentro de la ventana de 120s" }),
      });
      setTicket({ ok: true, text: "Anulado." });
      await refresh();
    } catch (e: unknown) {
      setTicket({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
      setTimeout(() => setTicket(null), 2500);
    }
  };

  const submitVoidRequest = async (paymentId: string) => {
    if (!voidReasonText.trim()) return;
    setLoading(true);
    try {
      await apiFetch(session, `/payments/${paymentId}/void`, {
        method: "POST",
        body: JSON.stringify({ reason: voidReasonText }),
      });
      setTicket({ ok: true, text: "Solicitud de anulación enviada." });
      setVoidReasonFor(null);
      setVoidReasonText("");
      await refresh();
    } catch (e: unknown) {
      setTicket({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
      setTimeout(() => setTicket(null), 2500);
    }
  };

  const resolveVoidRequest = async (requestId: string, decision: "AUTHORIZED" | "DENIED") => {
    setLoading(true);
    try {
      await apiFetch(session, `/payments/void-requests/${requestId}/authorize`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      setTicket({ ok: true, text: decision === "AUTHORIZED" ? "Anulación autorizada." : "Anulación denegada." });
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, fontSize: 13 }}>
        <div>
          Caja: <strong style={{ color: noSession ? colors.dangerText : colors.success }}>{noSession ? "SIN ABRIR" : cashStatus!.status}</strong>
          {cashStatus?.expectedCash && <span style={{ color: colors.textMuted, marginLeft: 8 }}>esperado {money(cashStatus.expectedCash)}</span>}
        </div>
      </div>

      {!noSession && (
        <button
          onClick={() => setCloseModalOpen(true)}
          style={{ marginBottom: 16, padding: "6px 12px", borderRadius: 6, border: `1px solid ${colors.border}`, background: "transparent", color: colors.textMuted, fontSize: 12, cursor: "pointer" }}
        >
          Cerrar caja / cuadre
        </button>
      )}

      {closeModalOpen && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.surface }}>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 6 }}>
            Efectivo contado (esperado: {cashStatus?.expectedCash ? money(cashStatus.expectedCash) : "—"})
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={countedCash}
              onChange={(e) => setCountedCash(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="0.00"
              style={{ flex: 1, padding: 8, borderRadius: 6, background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
            />
            <button onClick={closeCashSession} disabled={loading} style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: colors.danger, color: colors.text, fontWeight: 700 }}>
              Cerrar
            </button>
          </div>
        </div>
      )}

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

      <div style={{ fontSize: 12, color: colors.textMuted, margin: "18px 0 8px" }}>COBROS RECIENTES</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {recentPayments.map((p) => {
          const secs = secondsSince(p.created_at);
          const selfEligible = canSelfVoid(p);
          const remainingWindow = Math.max(0, SELF_VOID_WINDOW_SECONDS - secs);
          return (
            <div
              key={p.id}
              style={{
                padding: 10,
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: p.status === "VOIDED" ? "#241C1A" : colors.surface,
                opacity: p.status === "VOIDED" ? 0.6 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                <span>{p.table_labels.join(", ")}</span>
                <span>{money(p.applied_amount)}</span>
              </div>
              {Number(p.change_amount) > 0 && <div style={{ fontSize: 11, color: colors.textMuted }}>cambio {money(p.change_amount)}</div>}

              {p.status === "VOIDED" ? (
                <div style={{ fontSize: 11, color: colors.dangerText, marginTop: 4 }}>ANULADO</div>
              ) : selfEligible ? (
                <button
                  onClick={() => executeSelfVoid(p.id)}
                  disabled={loading}
                  style={{ marginTop: 6, width: "100%", background: colors.danger, color: colors.text, border: "none", borderRadius: 8, padding: "8px 0", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                >
                  Anular ({Math.ceil(remainingWindow)}s)
                </button>
              ) : voidReasonFor === p.id ? (
                <div style={{ marginTop: 6 }}>
                  <input
                    value={voidReasonText}
                    onChange={(e) => setVoidReasonText(e.target.value)}
                    placeholder="Motivo de anulación"
                    style={{ width: "100%", boxSizing: "border-box", background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.text, padding: "6px 8px", fontSize: 12, marginBottom: 4 }}
                  />
                  <button
                    onClick={() => submitVoidRequest(p.id)}
                    disabled={loading}
                    style={{ width: "100%", background: colors.danger, color: colors.text, border: "none", borderRadius: 8, padding: "8px 0", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                  >
                    Enviar solicitud
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setVoidReasonFor(p.id)}
                  style={{ marginTop: 6, width: "100%", background: "transparent", color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: 8, padding: "6px 0", fontSize: 11, cursor: "pointer" }}
                >
                  Solicitar anulación
                </button>
              )}
            </div>
          );
        })}
        {recentPayments.length === 0 && <div style={{ color: colors.textDim, fontSize: 13 }}>Aún no hay cobros.</div>}
      </div>

      {canAuthorize && (
        <>
          <div style={{ fontSize: 12, color: colors.textMuted, margin: "18px 0 8px" }}>
            AUTORIZACIONES PENDIENTES ({pendingVoidRequests.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingVoidRequests.map((vr) => (
              <div key={vr.id} style={{ padding: 10, borderRadius: 10, border: `1px solid ${colors.accent}`, background: "#2B2416" }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{money(vr.applied_amount)}</div>
                <div style={{ fontSize: 11, color: colors.textMuted, margin: "4px 0" }}>{vr.reason}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => resolveVoidRequest(vr.id, "AUTHORIZED")}
                    disabled={loading}
                    style={{ ...btnPrimary, flex: 1, padding: "6px 0", fontSize: 12 }}
                  >
                    Autorizar
                  </button>
                  <button
                    onClick={() => resolveVoidRequest(vr.id, "DENIED")}
                    disabled={loading}
                    style={{ flex: 1, background: "transparent", color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: 8, padding: "6px 0", fontSize: 12, cursor: "pointer" }}
                  >
                    Denegar
                  </button>
                </div>
              </div>
            ))}
            {pendingVoidRequests.length === 0 && <div style={{ color: colors.textDim, fontSize: 12 }}>Sin solicitudes.</div>}
          </div>
        </>
      )}

      {ticket && (
        <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: ticket.ok ? "#1E2A1D" : "#2A1D1A", color: ticket.ok ? colors.success : colors.dangerText, fontSize: 13 }}>
          {ticket.text}
        </div>
      )}
    </div>
  );
  }
