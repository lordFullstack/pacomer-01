import React, { useEffect, useState } from "react";
import { Session } from "../../types";
import { apiFetch, money } from "../../lib/api";
import { colors, btnPrimary, btnGhost } from "../../lib/theme";

interface DailySales {
  date: string;
  totalApplied: string;
  paymentCount: number;
  byServer: Array<{ serverUserId: string; totalApplied: string }>;
  byMethod: Array<{ method: string; totalTendered: string }>;
}
interface CashStatus {
  status: string;
  openingCash: string | null;
  expectedCash: string | null;
}
interface CustomerCredits {
  customers: Array<{ customerId: string; name: string; outstandingBalance: string }>;
  totalOutstanding: string;
}
interface Payables {
  suppliers: Array<{ supplierId: string; name: string; outstandingBalance: string }>;
  totalPayable: string;
}

interface VoidRequest {
  id: string;
  status: "PENDING_AUTHORIZATION" | "AUTHORIZED" | "DENIED" | "EXECUTED" | "SELF_EXECUTED";
  reason: string;
  requestedByUserId: string;
  authorizedByUserId: string | null;
  requestedAt: string;
  resolvedAt: string | null;
}

interface LogPayment {
  id: string;
  status: "ACTIVE" | "VOIDED";
  applied_amount: string;
  change_amount: string;
  created_by_user_id: string;
  created_at: string;
  table_labels: string[];
  voidRequest: VoidRequest | null;
}

const SELF_VOID_WINDOW_SECONDS = 120;

const card: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  border: `1px solid ${colors.border}`,
  background: colors.surface,
};
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: colors.textMuted, marginBottom: 10 };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 };

/**
 * Panel de reportes — combina los 4 endpoints de solo lectura de /reports
 * en un solo dashboard. Nunca escribe nada, así que no hay riesgo de tocar
 * el flujo crítico de caja/pagos (12_REPORTS.md).
 */
export default function ReportsScreen({ session }: { session: Session }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sales, setSales] = useState<DailySales | null>(null);
  const [cash, setCash] = useState<CashStatus | null>(null);
  const [credits, setCredits] = useState<CustomerCredits | null>(null);
  const [payables, setPayables] = useState<Payables | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [logs, setLogs] = useState<LogPayment[]>([]);
  const [voidReasonFor, setVoidReasonFor] = useState<string | null>(null);
  const [voidReasonText, setVoidReasonText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [, forceTick] = useState(0);

  const canAuthorize = session.role === "supervisor" || session.role === "admin";

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    setError(null);
    try {
      const [s, c, cr, p, l] = await Promise.all([
        apiFetch(session, `/reports/daily-sales?date=${date}`),
        apiFetch(session, "/reports/cash-status"),
        apiFetch(session, "/reports/customer-credits"),
        apiFetch(session, "/reports/payables"),
        apiFetch(session, `/payments/log?date=${date}`),
      ]);
      setSales(s);
      setCash(c);
      setCredits(cr);
      setPayables(p);
      setLogs(l.payments);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error cargando reportes");
    }
  };

  const secondsSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 1000;
  const canSelfVoid = (p: LogPayment) =>
    p.status === "ACTIVE" && p.created_by_user_id === session.userId && secondsSince(p.created_at) <= SELF_VOID_WINDOW_SECONDS;

  const requestVoidAction = async (paymentId: string, reason: string) => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await apiFetch(session, `/payments/${paymentId}/void`, { method: "POST", body: JSON.stringify({ reason }) });
      setMsg({ ok: true, text: "Anulación procesada." });
      setVoidReasonFor(null);
      setVoidReasonText("");
      await load();
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 2500);
    }
  };

  const authorizeVoidAction = async (requestId: string, decision: "AUTHORIZED" | "DENIED") => {
    setBusy(true);
    try {
      await apiFetch(session, `/payments/void-requests/${requestId}/authorize`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      setMsg({ ok: true, text: decision === "AUTHORIZED" ? "Anulación autorizada." : "Anulación denegada." });
      await load();
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 2500);
    }
  };

  const logsByTable = logs.reduce<Record<string, LogPayment[]>>((acc, p) => {
    const labels = p.table_labels.length ? p.table_labels : ["Sin mesa"];
    for (const l of labels) {
      (acc[l] ||= []).push(p);
    }
    return acc;
  }, {});
  const tableKeys = Object.keys(logsByTable).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Reportes</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ padding: 8, borderRadius: 6, background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
          />
          <button onClick={load} style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${colors.border}`, background: "transparent", color: colors.textMuted, cursor: "pointer" }}>
            Actualizar
          </button>
        </div>
      </div>

      {error && <div style={{ color: colors.dangerText, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      <div style={{ ...card, marginBottom: 14, background: `linear-gradient(135deg, ${colors.surface}, ${colors.bg})` }}>
        <div style={label}>VENTAS DEL DÍA</div>
        {sales ? (
          <>
            <div style={{ fontSize: 32, fontWeight: 800, marginBottom: 4, color: colors.accent }}>{money(sales.totalApplied)}</div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 14 }}>{sales.paymentCount} cobros registrados</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {sales.byMethod.map((m) => (
                <div key={m.method} style={{ flex: "1 1 120px", padding: "8px 12px", borderRadius: 8, background: colors.bg, border: `1px solid ${colors.border}` }}>
                  <div style={{ fontSize: 11, color: colors.textMuted, textTransform: "capitalize", marginBottom: 2 }}>{m.method}</div>
                  <div style={{ fontWeight: 700 }}>{money(m.totalTendered)}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ color: colors.textDim, fontSize: 13 }}>Cargando…</div>
        )}
      </div>

      <div style={grid}>
        <div style={card}>
          <div style={label}>ESTADO DE CAJA</div>
          {cash && cash.status !== "NO_SESSION" ? (
            <>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                Estado: <strong style={{ color: colors.success }}>{cash.status}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                <span style={{ color: colors.textMuted }}>Base inicial</span>
                <span>{cash.openingCash ? money(cash.openingCash) : "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                <span style={{ color: colors.textMuted }}>Esperado en caja</span>
                <span>{cash.expectedCash ? money(cash.expectedCash) : "—"}</span>
              </div>
            </>
          ) : (
            <div style={{ color: colors.textDim, fontSize: 13 }}>Caja sin abrir.</div>
          )}
        </div>

        <div style={card}>
          <div style={label}>CRÉDITOS PENDIENTES POR COBRAR</div>
          {credits && credits.customers.length > 0 ? (
            <>
              {credits.customers.map((c) => (
                <div key={c.customerId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                  <span>{c.name}</span>
                  <span style={{ color: colors.dangerText }}>{money(c.outstandingBalance)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${colors.border}`, fontWeight: 700 }}>
                <span>Total</span>
                <span>{money(credits.totalOutstanding)}</span>
              </div>
            </>
          ) : (
            <div style={{ color: colors.textDim, fontSize: 13 }}>Sin créditos pendientes.</div>
          )}
        </div>

        <div style={card}>
          <div style={label}>CUENTAS POR PAGAR A PROVEEDORES</div>
          {payables && payables.suppliers.length > 0 ? (
            <>
              {payables.suppliers.map((s) => (
                <div key={s.supplierId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                  <span>{s.name}</span>
                  <span style={{ color: colors.dangerText }}>{money(s.outstandingBalance)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${colors.border}`, fontWeight: 700 }}>
                <span>Total</span>
                <span>{money(payables.totalPayable)}</span>
              </div>
            </>
          ) : (
            <div style={{ color: colors.textDim, fontSize: 13 }}>Sin cuentas por pagar.</div>
          )}
        </div>
      </div>

      {msg && (
        <div style={{ marginTop: 16, padding: 10, borderRadius: 8, background: msg.ok ? "#1E2A1D" : "#2A1D1A", color: msg.ok ? colors.success : colors.dangerText, fontSize: 13 }}>
          {msg.text}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Logs de anulaciones</div>
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 14 }}>
          Cobros de {date}, agrupados por mesa. Anular y autorizar se hace desde aquí.
        </div>

        {tableKeys.length === 0 && <div style={{ color: colors.textDim, fontSize: 13 }}>Sin cobros ese día.</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {tableKeys.map((tableLabel) => (
            <div key={tableLabel}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.accent, marginBottom: 6 }}>MESA {tableLabel}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {logsByTable[tableLabel].map((p) => {
                  const selfEligible = canSelfVoid(p);
                  const remainingWindow = Math.max(0, SELF_VOID_WINDOW_SECONDS - secondsSince(p.created_at));
                  return (
                    <div
                      key={p.id + tableLabel}
                      style={{
                        padding: 10,
                        borderRadius: 10,
                        border: `1px solid ${colors.border}`,
                        background: p.status === "VOIDED" ? "#241C1A" : colors.surface,
                        opacity: p.status === "VOIDED" ? 0.7 : 1,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                        <span>{new Date(p.created_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span>
                        <span>{money(p.applied_amount)}</span>
                      </div>
                      {Number(p.change_amount) > 0 && <div style={{ fontSize: 11, color: colors.textMuted }}>cambio {money(p.change_amount)}</div>}

                      {p.status === "VOIDED" ? (
                        <div style={{ fontSize: 11, color: colors.dangerText, marginTop: 4 }}>
                          ANULADO{p.voidRequest ? ` · ${p.voidRequest.reason}` : ""}
                        </div>
                      ) : p.voidRequest?.status === "PENDING_AUTHORIZATION" ? (
                        canAuthorize ? (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 6 }}>{p.voidRequest.reason}</div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={() => authorizeVoidAction(p.voidRequest!.id, "AUTHORIZED")} disabled={busy} style={{ ...btnPrimary, flex: 1, padding: "6px 0", fontSize: 12 }}>
                                Autorizar
                              </button>
                              <button
                                onClick={() => authorizeVoidAction(p.voidRequest!.id, "DENIED")}
                                disabled={busy}
                                style={{ flex: 1, background: "transparent", color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: 8, padding: "6px 0", fontSize: 12, cursor: "pointer" }}
                              >
                                Denegar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, color: colors.accent, marginTop: 4 }}>Pendiente de autorización</div>
                        )
                      ) : p.voidRequest?.status === "DENIED" ? (
                        <div style={{ fontSize: 11, color: colors.textDim, marginTop: 4 }}>Anulación denegada</div>
                      ) : selfEligible ? (
                        <button
                          onClick={() => requestVoidAction(p.id, "Auto-anulación dentro de la ventana de 120s")}
                          disabled={busy}
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
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => requestVoidAction(p.id, voidReasonText)}
                              disabled={busy || !voidReasonText.trim()}
                              style={{ flex: 1, background: colors.danger, color: colors.text, border: "none", borderRadius: 8, padding: "8px 0", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                            >
                              Enviar
                            </button>
                            <button onClick={() => setVoidReasonFor(null)} style={{ ...btnGhost, flex: 1 }}>
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setVoidReasonFor(p.id);
                            setVoidReasonText("");
                          }}
                          style={{ marginTop: 6, width: "100%", background: "transparent", color: colors.textMuted, border: `1px solid ${colors.border}`, borderRadius: 8, padding: "6px 0", fontSize: 11, cursor: "pointer" }}
                        >
                          Solicitar anulación
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
