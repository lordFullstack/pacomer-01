import React, { useState, useEffect, useCallback } from "react";
import { Session } from "../types";
import { apiFetch, genIdempotencyKey, money } from "../lib/api";
import { colors, btnPrimary, btnGhost } from "../lib/theme";

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

interface CashStatus {
  sessionId: string | null;
  status: string;
  expectedCash: string | null;
}

interface TableSummary {
  id: string;
  label: string;
  hasOpenAccount: boolean;
  dinerCount: number;
  total: string;
  openedAt: string | null;
}

interface TableDiner {
  dinerId: string;
  obligationId: string;
  name: string | null;
  descriptor: string | null;
  amount: string;
  status: "PENDING" | "PARTIAL" | "CREDIT" | "SETTLED";
  remaining: string;
  createdAt: string;
}

const occupiedGreen = "#0F7A44";
const occupiedGreenBorder = "#0A5C33";

interface TableDetail {
  tableId: string;
  tableLabel: string;
  openedAt: string | null;
  diners: TableDiner[];
}

export default function CashierScreen({ session }: { session: Session }) {
  const [pending, setPending] = useState<PendingObligation[]>([]);
  const [recentPayments, setRecentPayments] = useState<RecentPayment[]>([]);
  const [cashStatus, setCashStatus] = useState<CashStatus | null>(null);
  const [openingCash, setOpeningCash] = useState("");
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [ticket, setTicket] = useState<{ text: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [, forceTick] = useState(0);

  const [tables, setTables] = useState<TableSummary[]>([]);
  const [mesaFilter, setMesaFilter] = useState<"todas" | "ocupadas" | "libres">("todas");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [tableDetail, setTableDetail] = useState<TableDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [addName, setAddName] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addNote, setAddNote] = useState("");

  const [fiarFor, setFiarFor] = useState<string | null>(null);
  const [fiarName, setFiarName] = useState("");
  const [fiarPhone, setFiarPhone] = useState("");

  const [confirmRelease, setConfirmRelease] = useState(false);

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [pendingRes, cashRes, paymentsRes, tablesRes] = await Promise.all([
        apiFetch(session, "/reports/pending-collections"),
        apiFetch(session, "/reports/cash-status"),
        apiFetch(session, "/payments/recent"),
        apiFetch(session, "/tables"),
      ]);
      setPending(pendingRes.obligations);
      setCashStatus(cashRes);
      setRecentPayments(paymentsRes.payments);
      setTables(tablesRes.tables);
    } catch {
      /* transient errors during polling are fine to ignore */
    }
  }, [session]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const loadTableDetail = useCallback(
    async (tableId: string) => {
      setDetailLoading(true);
      try {
        const detail = await apiFetch(session, `/tables/${tableId}/session`);
        setTableDetail(detail);
      } catch (e: unknown) {
        setTicket({ ok: false, text: e instanceof Error ? e.message : "Error" });
      } finally {
        setDetailLoading(false);
      }
    },
    [session]
  );

  const openTable = (tableId: string) => {
    setSelectedTableId(tableId);
    setFiarFor(null);
    setConfirmRelease(false);
    setAddName("");
    setAddAmount("");
    setAddNote("");
    loadTableDetail(tableId);
  };

  const closeDetail = () => {
    setSelectedTableId(null);
    setTableDetail(null);
    setFiarFor(null);
    setConfirmRelease(false);
  };

  const openingCashSession = async () => {
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

  const addPersona = async () => {
    if (!selectedTableId || !addAmount) return;
    setLoading(true);
    try {
      await apiFetch(session, "/service-line/diners", {
        method: "POST",
        body: JSON.stringify({
          tableId: selectedTableId,
          amount: addAmount,
          paymentMode: "individual",
          name: addName || undefined,
          descriptor: addNote || undefined,
          idempotencyKey: genIdempotencyKey(),
        }),
      });
      setAddName("");
      setAddAmount("");
      setAddNote("");
      await Promise.all([loadTableDetail(selectedTableId), refresh()]);
    } catch (e: unknown) {
      setTicket({ ok: false, text: e instanceof Error ? e.message : "Error" });
      setTimeout(() => setTicket(null), 2500);
    } finally {
      setLoading(false);
    }
  };

  const cobrarObligation = async (obligationId: string, amount: string) => {
    setLoading(true);
    try {
      const out = await apiFetch(session, "/payments", {
        method: "POST",
        body: JSON.stringify({
          obligationIds: [obligationId],
          tenders: [{ method: "efectivo", amount }],
          idempotencyKey: genIdempotencyKey(),
        }),
      });
      setTicket({ ok: true, text: `Cobrado ${money(out.appliedAmount)}` });
      if (selectedTableId) await loadTableDetail(selectedTableId);
      await refresh();
    } catch (e: unknown) {
      setTicket({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
      setTimeout(() => setTicket(null), 2500);
    }
  };

  const cobrarTodo = async () => {
    if (!tableDetail || !selectedTableId) return;
    const owed = tableDetail.diners.filter((d) => Number(d.remaining) > 0);
    if (owed.length === 0) return;
    setLoading(true);
    try {
      const total = owed.reduce((s, d) => s + Number(d.remaining), 0).toFixed(2);
      await apiFetch(session, "/payments", {
        method: "POST",
        body: JSON.stringify({
          obligationIds: owed.map((d) => d.obligationId),
          tenders: [{ method: "efectivo", amount: total }],
          idempotencyKey: genIdempotencyKey(),
        }),
      });
      await apiFetch(session, `/tables/${selectedTableId}/release`, { method: "POST" });
      setTicket({ ok: true, text: `Mesa cobrada y liberada · ${money(total)}` });
      closeDetail();
      await refresh();
    } catch (e: unknown) {
      setTicket({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
      setTimeout(() => setTicket(null), 2500);
    }
  };

  const liberarSinCobrar = async () => {
    if (!selectedTableId) return;
    setLoading(true);
    try {
      await apiFetch(session, `/tables/${selectedTableId}/release`, { method: "POST" });
      setTicket({ ok: true, text: "Mesa liberada." });
      closeDetail();
      await refresh();
    } catch (e: unknown) {
      setTicket({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
      setTimeout(() => setTicket(null), 2500);
    }
  };

  const fiarObligation = async (obligationId: string, amount: string) => {
    if (!fiarName.trim() || !fiarPhone.trim()) return;
    setLoading(true);
    try {
      await apiFetch(session, "/credits", {
        method: "POST",
        body: JSON.stringify({
          obligationIds: [obligationId],
          customer: { name: fiarName.trim(), phone: fiarPhone.trim(), type: "persona", creditLimit: amount },
          idempotencyKey: genIdempotencyKey(),
        }),
      });
      setTicket({ ok: true, text: "Fiado registrado." });
      setFiarFor(null);
      setFiarName("");
      setFiarPhone("");
      if (selectedTableId) await loadTableDetail(selectedTableId);
      await refresh();
    } catch (e: unknown) {
      setTicket({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
      setTimeout(() => setTicket(null), 2500);
    }
  };

  const secondsSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 1000;

  const timeAgo = (iso: string) => {
    const mins = Math.floor(secondsSince(iso) / 60);
    return mins < 1 ? "Ahora" : `hace ${mins}m`;
  };

  const noSession = !cashStatus || cashStatus.status === "NO_SESSION";
  const occupiedTables = tables.filter((t) => t.hasOpenAccount);
  const pendingTotal = pending.reduce((s, o) => s + Number(o.remaining), 0);
  const visibleTables = tables.filter((t) => {
    if (mesaFilter === "ocupadas") return t.hasOpenAccount;
    if (mesaFilter === "libres") return !t.hasOpenAccount;
    return true;
  });

  return (
    <div style={{ padding: 20, maxWidth: 720, margin: "0 auto", fontFamily: "'Inter', 'Segoe UI', ui-sans-serif, sans-serif" }}>
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
            <button onClick={openingCashSession} disabled={loading} style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: colors.accent, color: colors.bg, fontWeight: 700 }}>
              Abrir
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <div style={{ flex: 1, padding: 14, borderRadius: 12, border: `1px solid ${colors.border}`, background: colors.surface, textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: colors.text }}>{occupiedTables.length}</div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>mesas activas</div>
        </div>
        <div style={{ flex: 1, padding: 14, borderRadius: 12, border: `1px solid ${colors.border}`, background: colors.surface, textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: colors.text }}>{money(pendingTotal)}</div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>total pendiente</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: colors.textMuted, letterSpacing: 0.5 }}>MESAS</div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["todas", "ocupadas", "libres"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setMesaFilter(f)}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                background: mesaFilter === f ? colors.accent : "transparent",
                color: mesaFilter === f ? colors.bg : colors.textMuted,
                fontSize: 11,
                fontWeight: 700,
                textTransform: "capitalize",
                cursor: "pointer",
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
          gap: 8,
          marginBottom: 20,
        }}
      >
        {visibleTables.map((t) => {
          const selected = t.id === selectedTableId;
          return (
            <button
              key={t.id}
              onClick={() => openTable(t.id)}
              style={{
                textAlign: "left",
                padding: 10,
                borderRadius: 10,
                border: selected ? `2px solid ${colors.accent}` : `1px solid ${t.hasOpenAccount ? occupiedGreenBorder : colors.border}`,
                background: t.hasOpenAccount ? occupiedGreen : colors.surface,
                color: t.hasOpenAccount ? "#FFFFFF" : colors.text,
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800 }}>{t.label}</div>
              {t.hasOpenAccount ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{money(t.total)}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.75)" }}>
                    {t.dinerCount}p{t.openedAt ? ` · ${timeAgo(t.openedAt)}` : ""}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 10, color: colors.textMuted, fontWeight: 700, marginTop: 3 }}>LIBRE</div>
              )}
            </button>
          );
        })}
        {visibleTables.length === 0 && <div style={{ color: colors.textDim, fontSize: 13 }}>Sin mesas.</div>}
      </div>

      <div style={{ fontSize: 12, color: colors.textMuted, margin: "18px 0 8px" }}>COBROS RECIENTES</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {recentPayments.map((p) => (
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
            {p.status === "VOIDED" && <div style={{ fontSize: 11, color: colors.dangerText, marginTop: 4 }}>ANULADO</div>}
          </div>
        ))}
        {recentPayments.length === 0 && <div style={{ color: colors.textDim, fontSize: 13 }}>Aún no hay cobros.</div>}
      </div>
      <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 14 }}>
        Las anulaciones se gestionan desde Reportes → Logs de anulaciones.
      </div>

      {ticket && (
        <div style={{ marginBottom: 14, padding: 10, borderRadius: 8, background: ticket.ok ? "#1E2A1D" : "#2A1D1A", color: ticket.ok ? colors.success : colors.dangerText, fontSize: 13 }}>
          {ticket.text}
        </div>
      )}

      {selectedTableId && (
        <div
          onClick={closeDetail}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(92vw, 440px)",
              maxHeight: "88vh",
              overflowY: "auto",
              padding: 16,
              borderRadius: 12,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 17 }}>Mesa {tableDetail?.tableLabel ?? "…"}</div>
                {tableDetail && (
                  <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                    {tableDetail.diners.length} persona{tableDetail.diners.length === 1 ? "" : "s"}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>{tableDetail?.openedAt ? timeAgo(tableDetail.openedAt) : ""}</div>
            </div>

            {detailLoading && <div style={{ color: colors.textDim, fontSize: 13, marginBottom: 10 }}>Cargando…</div>}

            {tableDetail && (
              <>
                {(() => {
                  const totalRemaining = tableDetail.diners.reduce((s, d) => s + Math.max(0, Number(d.remaining)), 0);
                  if (totalRemaining <= 0) return null;
                  const nothingPaidYet = tableDetail.diners.every((d) => Number(d.remaining) >= Number(d.amount));
                  return (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#332A1C", border: `1.5px solid ${colors.accent}`, borderRadius: 10, padding: "11px 13px", marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>Total mesa</div>
                        <div style={{ fontSize: 10, color: colors.textMuted }}>{nothingPaidYet ? "Todo pendiente" : "Parcial pendiente"}</div>
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: colors.accent }}>{money(totalRemaining)}</div>
                    </div>
                  );
                })()}

                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                  {tableDetail.diners.map((d, i) => {
                    const owed = Number(d.remaining) > 0;
                    return (
                      <div key={d.dinerId} style={{ padding: 11, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.bg }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: 15, fontWeight: 800 }}>
                              <span style={{ fontSize: 11, color: colors.textMuted, fontWeight: 400 }}>#{i + 1}</span> {money(d.remaining)}
                            </div>
                            <div style={{ fontSize: 12, color: colors.textMuted }}>
                              {d.name || `Comensal ${i + 1}`}
                              {d.descriptor && ` · ${d.descriptor}`}
                            </div>
                            <div style={{ fontSize: 10, color: colors.textDim, marginTop: 1 }}>{timeAgo(d.createdAt)}</div>
                          </div>
                          {owed ? null : (
                            <div style={{ fontSize: 11, color: colors.textDim, fontWeight: 700 }}>{d.status === "CREDIT" ? "FIADO" : "PAGADO"}</div>
                          )}
                        </div>
                        {owed &&
                          (fiarFor === d.obligationId ? (
                            <div style={{ marginTop: 8 }}>
                              <input
                                value={fiarName}
                                onChange={(e) => setFiarName(e.target.value)}
                                placeholder="Nombre del cliente"
                                style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 6, background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, marginBottom: 6, fontSize: 12 }}
                              />
                              <input
                                value={fiarPhone}
                                onChange={(e) => setFiarPhone(e.target.value)}
                                placeholder="Teléfono"
                                style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 6, background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, marginBottom: 6, fontSize: 12 }}
                              />
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  onClick={() => fiarObligation(d.obligationId, d.remaining)}
                                  disabled={loading || !fiarName.trim() || !fiarPhone.trim()}
                                  style={{ ...btnPrimary, flex: 1, padding: "8px 0", fontSize: 12 }}
                                >
                                  Confirmar fiado
                                </button>
                                <button onClick={() => setFiarFor(null)} style={{ ...btnGhost, flex: 1 }}>
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
                              <button
                                onClick={() => cobrarObligation(d.obligationId, d.remaining)}
                                disabled={loading}
                                style={{ background: occupiedGreen, color: "#FFFFFF", border: "none", borderRadius: 6, padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                              >
                                Cobrar
                              </button>
                              <button
                                onClick={() => {
                                  setFiarFor(d.obligationId);
                                  setFiarName("");
                                  setFiarPhone("");
                                }}
                                disabled={loading}
                                style={{ background: "transparent", color: colors.info, border: `1px solid ${colors.info}`, borderRadius: 6, padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                              >
                                Fiar
                              </button>
                            </div>
                          ))}
                      </div>
                    );
                  })}
                  {tableDetail.diners.length === 0 && <div style={{ color: colors.textDim, fontSize: 13 }}>Sin comensales todavía.</div>}
                </div>

                <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 6, letterSpacing: 0.5 }}>+ AGREGAR PERSONA</div>
                <input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="Nombre (opcional)"
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 6, background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, marginBottom: 6, fontSize: 12 }}
                />
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input
                    value={addAmount}
                    onChange={(e) => setAddAmount(e.target.value.replace(/[^\d.]/g, ""))}
                    placeholder="$0"
                    style={{ flex: 1, boxSizing: "border-box", padding: 8, borderRadius: 6, background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, fontSize: 12 }}
                  />
                  <button
                    onClick={addPersona}
                    disabled={loading || !addAmount}
                    style={{ padding: "0 16px", borderRadius: 6, border: "none", background: colors.accent, color: colors.bg, fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                  >
                    Agregar
                  </button>
                </div>
                <input
                  value={addNote}
                  onChange={(e) => setAddNote(e.target.value)}
                  placeholder="Nota (opcional)"
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 6, background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, marginBottom: 16, fontSize: 12 }}
                />

                <button
                  onClick={cobrarTodo}
                  disabled={loading || tableDetail.diners.every((d) => Number(d.remaining) <= 0)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    padding: 12,
                    borderRadius: 10,
                    border: "none",
                    background: occupiedGreen,
                    color: "#FFFFFF",
                    fontWeight: 800,
                    marginBottom: 8,
                    cursor: "pointer",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
                  Cobrar todo — {money(tableDetail.diners.reduce((s, d) => s + Math.max(0, Number(d.remaining)), 0))}
                </button>

                {confirmRelease ? (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: colors.dangerText, marginBottom: 6 }}>
                      ¿Liberar la mesa sin cobrar lo pendiente?
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={liberarSinCobrar}
                        disabled={loading}
                        style={{ flex: 1, background: colors.danger, color: colors.text, border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, cursor: "pointer" }}
                      >
                        Sí, liberar
                      </button>
                      <button onClick={() => setConfirmRelease(false)} style={{ ...btnGhost, flex: 1 }}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmRelease(true)}
                    disabled={loading}
                    style={{ width: "100%", background: "transparent", color: colors.dangerText, border: `1px solid ${colors.danger}`, borderRadius: 8, padding: "10px 0", fontWeight: 700, marginBottom: 8, cursor: "pointer" }}
                  >
                    Liberar sin cobrar
                  </button>
                )}

                <button onClick={closeDetail} style={{ ...btnGhost, width: "100%", padding: "10px 0" }}>
                  Cerrar
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
