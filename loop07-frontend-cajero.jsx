import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";

/**
 * LOOP 07 — Frontend Cajero
 *
 * Built on top of the rules closed in LOOP 08 (Tender/PaymentAllocation/
 * Change, partial/mixed payments) and LOOP 13 (BR-016 self-void window,
 * BR-017 supervisor authorization). This is a UI prototype: all backend
 * calls are mocked with the same shapes the real API (LOOP 05/08) returns,
 * so wiring in `fetch` later is a drop-in swap, not a rewrite.
 *
 * Design continues the counter-side visual language from LOOP 06 (dark,
 * glare-resistant, one confident amber for the primary action) so the
 * server and cashier screens read as the same product, not two apps.
 * The cashier's own signature moment: pending obligations sit in a single
 * scrollable rail (mirrors the physical ticket rail by the register in
 * 01_DISCOVERY.md), and a paid item peels off the rail rather than just
 * vanishing — motion that mimics tearing a ticket off the spike.
 */

type ObligationStatus = "PENDING" | "PARTIAL" | "PAID";
type Role = "cajero" | "supervisor" | "admin";

interface Obligation {
  id: string;
  tableId: number;
  dinerName?: string;
  descriptor?: string;
  serverName: string;
  amount: number; // full amount
  paidSoFar: number; // sum of active allocations
  status: ObligationStatus;
  createdAt: number;
}

interface PaymentRecord {
  id: string;
  obligationIds: string[];
  tableIds: number[];
  appliedAmount: number;
  changeAmount: number;
  cashAmount: number;
  transferAmount: number;
  createdByUserId: string;
  createdAt: number;
  status: "ACTIVE" | "VOIDED";
}

interface VoidRequest {
  id: string;
  paymentId: string;
  reason: string;
  status: "PENDING_AUTHORIZATION" | "AUTHORIZED" | "DENIED" | "EXECUTED" | "SELF_EXECUTED";
  requestedAt: number;
}

const SELF_VOID_WINDOW_SECONDS = 120;
const CURRENT_USER_ID = "cajero-ana"; // the logged-in cashier for this demo

const money = (n: number) =>
  n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

function seedObligations(): Obligation[] {
  const names = [
    { table: 3, name: "Sr. Gómez", server: "Luis" },
    { table: 3, name: undefined, server: "Luis" },
    { table: 7, name: "camisa azul", server: "Marta" },
    { table: 9, name: "Sra. Rojas", server: "Pedro" },
    { table: 12, name: undefined, server: "Ana" },
  ];
  const now = Date.now();
  return names.map((n, i) => ({
    id: `ob-${i}`,
    tableId: n.table,
    dinerName: n.name,
    descriptor: undefined,
    serverName: n.server,
    amount: [12000, 8500, 15000, 22000, 9000][i],
    paidSoFar: 0,
    status: "PENDING",
    createdAt: now - i * 40_000,
  }));
}

export default function CashierScreen() {
  const [role, setRole] = useState<Role>("cajero");
  const [obligations, setObligations] = useState<Obligation[]>(seedObligations);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [voidRequests, setVoidRequests] = useState<VoidRequest[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payDrawerOpen, setPayDrawerOpen] = useState(false);
  const [cashInput, setCashInput] = useState("");
  const [transferInput, setTransferInput] = useState("");
  const [ticket, setTicket] = useState<{ table: string; applied: number; change: number } | null>(null);
  const [conn, setConn] = useState<"online" | "offline">("online");

  // Cash session
  const [sessionStatus, setSessionStatus] = useState<"CLOSED" | "OPEN">("OPEN");
  const [openingCash] = useState(50000);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [countedCash, setCountedCash] = useState("");

  const [voidReasonFor, setVoidReasonFor] = useState<string | null>(null);
  const [voidReasonText, setVoidReasonText] = useState("");

  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000); // drives self-void countdowns
    return () => clearInterval(t);
  }, []);

  const pending = obligations.filter((o) => o.status !== "PAID");
  const selectedObligations = pending.filter((o) => selected.has(o.id));
  const selectedRemaining = selectedObligations.reduce((s, o) => s + (o.amount - o.paidSoFar), 0);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openPayDrawer = () => {
    if (selected.size === 0) return;
    setCashInput(selectedRemaining.toString());
    setTransferInput("");
    setPayDrawerOpen(true);
  };

  const cashCents = Number(cashInput || 0);
  const transferCents = Number(transferInput || 0);
  const tenderedTotal = cashCents + transferCents;
  const appliedPreview = Math.min(tenderedTotal, selectedRemaining);
  const changePreview = Math.max(0, tenderedTotal - selectedRemaining);
  const changeValid = changePreview <= cashCents;

  const cameraTableLabel = useMemo(
    () => [...new Set(selectedObligations.map((o) => o.tableId))].map((t) => `Mesa ${t}`).join(", "),
    [selectedObligations]
  );

  const confirmPayment = () => {
    if (tenderedTotal <= 0 || !changeValid) return;

    let toAllocate = tenderedTotal;
    const updatedObligations = [...obligations];
    for (const sel of selectedObligations) {
      if (toAllocate <= 0) break;
      const remaining = sel.amount - sel.paidSoFar;
      const apply = Math.min(toAllocate, remaining);
      toAllocate -= apply;
      const idx = updatedObligations.findIndex((o) => o.id === sel.id);
      const newPaid = updatedObligations[idx].paidSoFar + apply;
      updatedObligations[idx] = {
        ...updatedObligations[idx],
        paidSoFar: newPaid,
        status: newPaid >= updatedObligations[idx].amount ? "PAID" : "PARTIAL",
      };
    }
    setObligations(updatedObligations);

    const payment: PaymentRecord = {
      id: `pay-${Date.now()}`,
      obligationIds: selectedObligations.map((o) => o.id),
      tableIds: [...new Set(selectedObligations.map((o) => o.tableId))],
      appliedAmount: appliedPreview,
      changeAmount: changePreview,
      cashAmount: cashCents,
      transferAmount: transferCents,
      createdByUserId: CURRENT_USER_ID,
      createdAt: Date.now(),
      status: "ACTIVE",
    };
    setPayments((p) => [payment, ...p]);
    setTicket({ table: cameraTableLabel, applied: appliedPreview, change: changePreview });
    window.setTimeout(() => setTicket(null), 2200);

    setSelected(new Set());
    setPayDrawerOpen(false);
  };

  const secondsSince = (ts: number) => (Date.now() - ts) / 1000;

  const canSelfVoid = (p: PaymentRecord) =>
    p.createdByUserId === CURRENT_USER_ID && secondsSince(p.createdAt) <= SELF_VOID_WINDOW_SECONDS;

  const reverseObligationsFor = useCallback(
    (obligationIds: string[], amountByObligation: Record<string, number>) => {
      setObligations((obs) =>
        obs.map((o) => {
          if (!obligationIds.includes(o.id)) return o;
          const newPaid = Math.max(0, o.paidSoFar - (amountByObligation[o.id] ?? 0));
          return { ...o, paidSoFar: newPaid, status: newPaid <= 0 ? "PENDING" : newPaid < o.amount ? "PARTIAL" : "PAID" };
        })
      );
    },
    []
  );

  const executeSelfVoid = (payment: PaymentRecord) => {
    // Approximate even split back per obligation for the demo reversal.
    const perObligation: Record<string, number> = {};
    payment.obligationIds.forEach((id) => {
      perObligation[id] = payment.appliedAmount / payment.obligationIds.length;
    });
    reverseObligationsFor(payment.obligationIds, perObligation);
    setPayments((ps) => ps.map((p) => (p.id === payment.id ? { ...p, status: "VOIDED" } : p)));
    setVoidRequests((v) => [
      { id: `vr-${Date.now()}`, paymentId: payment.id, reason: "Auto-anulación (ventana BR-016)", status: "SELF_EXECUTED", requestedAt: Date.now() },
      ...v,
    ]);
  };

  const submitVoidRequest = (paymentId: string) => {
    if (!voidReasonText.trim()) return;
    setVoidRequests((v) => [
      { id: `vr-${Date.now()}`, paymentId, reason: voidReasonText, status: "PENDING_AUTHORIZATION", requestedAt: Date.now() },
      ...v,
    ]);
    setVoidReasonFor(null);
    setVoidReasonText("");
  };

  const resolveVoidRequest = (vr: VoidRequest, decision: "AUTHORIZED" | "DENIED") => {
    setVoidRequests((vs) => vs.map((v) => (v.id === vr.id ? { ...v, status: decision === "AUTHORIZED" ? "EXECUTED" : "DENIED" } : v)));
    if (decision === "AUTHORIZED") {
      const payment = payments.find((p) => p.id === vr.paymentId);
      if (payment) {
        const perObligation: Record<string, number> = {};
        payment.obligationIds.forEach((id) => {
          perObligation[id] = payment.appliedAmount / payment.obligationIds.length;
        });
        reverseObligationsFor(payment.obligationIds, perObligation);
        setPayments((ps) => ps.map((p) => (p.id === vr.paymentId ? { ...p, status: "VOIDED" } : p)));
      }
    }
  };

  const pendingAuthorizations = voidRequests.filter((v) => v.status === "PENDING_AUTHORIZATION");

  const expectedCash =
    openingCash + payments.filter((p) => p.status === "ACTIVE").reduce((s, p) => s + p.cashAmount - p.changeAmount, 0);

  return (
    <div style={{ minHeight: "100vh", background: "#1C1A17", color: "#F5F1EA", fontFamily: "'Segoe UI', ui-sans-serif, system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #33302A" }}>
        <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: 0.5 }}>FAST TRACK · CAJA</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            title="Cambiar rol (solo para demo)"
            style={{ background: "#26221D", color: "#F5F1EA", border: "1px solid #33302A", borderRadius: 8, padding: "5px 8px", fontSize: 12 }}
          >
            <option value="cajero">Rol: Cajero</option>
            <option value="supervisor">Rol: Supervisor</option>
            <option value="admin">Rol: Admin</option>
          </select>
          <button
            onClick={() => setConn((c) => (c === "online" ? "offline" : "online"))}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid #33302A", borderRadius: 999, padding: "5px 10px", cursor: "pointer", color: conn === "online" ? "#8FBF8A" : "#D98A6E", fontSize: 12 }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: conn === "online" ? "#8FBF8A" : "#B3452F", display: "inline-block" }} />
            {conn === "online" ? "Conectado" : "Sin conexión"}
          </button>
        </div>
      </div>

      {/* Cash session bar */}
      <div style={{ padding: "10px 18px", borderBottom: "1px solid #26221D", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
        <div>
          Caja: <strong style={{ color: sessionStatus === "OPEN" ? "#8FBF8A" : "#D98A6E" }}>{sessionStatus === "OPEN" ? "ABIERTA" : "CERRADA"}</strong>
          {sessionStatus === "OPEN" && <span style={{ color: "#9C948A", marginLeft: 10 }}>esperado: {money(expectedCash)}</span>}
        </div>
        {sessionStatus === "OPEN" ? (
          <button onClick={() => setCloseModalOpen(true)} style={btnGhost}>Cerrar caja / cuadre</button>
        ) : (
          <button onClick={() => setSessionStatus("OPEN")} style={btnGhost}>Abrir caja</button>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", gap: 0, maxWidth: 920, margin: "0 auto", width: "100%" }}>
        {/* Pending rail */}
        <div style={{ flex: 1, padding: "16px 18px", borderRight: "1px solid #26221D" }}>
          <div style={{ fontSize: 12, color: "#9C948A", marginBottom: 10, fontWeight: 600, letterSpacing: 0.4 }}>
            PENDIENTES ({pending.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map((o) => (
              <button
                key={o.id}
                onClick={() => toggleSelect(o.id)}
                style={{
                  textAlign: "left",
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: selected.has(o.id) ? "2px solid #E8A33D" : "1px solid #33302A",
                  background: selected.has(o.id) ? "#332A1C" : "#26221D",
                  color: "#F5F1EA",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                  <span>
                    Mesa {o.tableId} {o.dinerName ? `· ${o.dinerName}` : o.descriptor ? `· ${o.descriptor}` : ""}
                  </span>
                  <span>{money(o.amount - o.paidSoFar)}</span>
                </div>
                <div style={{ fontSize: 12, color: "#9C948A", marginTop: 2 }}>
                  {o.serverName} · {o.status === "PARTIAL" ? "abono parcial" : "pendiente"}
                </div>
              </button>
            ))}
            {pending.length === 0 && <div style={{ color: "#5A554C", fontSize: 13 }}>Sin pendientes.</div>}
          </div>

          {selected.size > 0 && (
            <button onClick={openPayDrawer} style={{ ...btnPrimary, width: "100%", marginTop: 14 }}>
              COBRAR {selected.size > 1 ? `(${selected.size} · conjunto)` : ""} · {money(selectedRemaining)}
            </button>
          )}
        </div>

        {/* Recent payments + void */}
        <div style={{ width: 300, padding: "16px 18px" }}>
          <div style={{ fontSize: 12, color: "#9C948A", marginBottom: 10, fontWeight: 600, letterSpacing: 0.4 }}>
            COBROS RECIENTES
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {payments.slice(0, 6).map((p) => {
              const secs = secondsSince(p.createdAt);
              const selfEligible = p.status === "ACTIVE" && canSelfVoid(p);
              const remainingWindow = Math.max(0, SELF_VOID_WINDOW_SECONDS - secs);
              return (
                <div key={p.id} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #33302A", background: p.status === "VOIDED" ? "#241C1A" : "#26221D", opacity: p.status === "VOIDED" ? 0.6 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                    <span>Mesa {p.tableIds.join(", ")}</span>
                    <span>{money(p.appliedAmount)}</span>
                  </div>
                  {p.changeAmount > 0 && <div style={{ fontSize: 11, color: "#9C948A" }}>cambio {money(p.changeAmount)}</div>}
                  {p.status === "VOIDED" ? (
                    <div style={{ fontSize: 11, color: "#D98A6E", marginTop: 4 }}>ANULADO</div>
                  ) : selfEligible ? (
                    <button onClick={() => executeSelfVoid(p)} style={{ ...btnDanger, marginTop: 6, width: "100%" }}>
                      Anular ({Math.ceil(remainingWindow)}s)
                    </button>
                  ) : voidReasonFor === p.id ? (
                    <div style={{ marginTop: 6 }}>
                      <input
                        value={voidReasonText}
                        onChange={(e) => setVoidReasonText(e.target.value)}
                        placeholder="Motivo de anulación"
                        style={{ width: "100%", boxSizing: "border-box", background: "#1C1A17", border: "1px solid #33302A", borderRadius: 6, color: "#F5F1EA", padding: "6px 8px", fontSize: 12, marginBottom: 4 }}
                      />
                      <button onClick={() => submitVoidRequest(p.id)} style={{ ...btnDanger, width: "100%" }}>
                        Enviar solicitud
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setVoidReasonFor(p.id)} style={{ ...btnGhost, marginTop: 6, width: "100%", fontSize: 11 }}>
                      Solicitar anulación
                    </button>
                  )}
                </div>
              );
            })}
            {payments.length === 0 && <div style={{ color: "#5A554C", fontSize: 13 }}>Aún no hay cobros.</div>}
          </div>

          {(role === "supervisor" || role === "admin") && (
            <>
              <div style={{ fontSize: 12, color: "#9C948A", margin: "18px 0 10px", fontWeight: 600, letterSpacing: 0.4 }}>
                AUTORIZACIONES PENDIENTES ({pendingAuthorizations.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pendingAuthorizations.map((vr) => {
                  const payment = payments.find((p) => p.id === vr.paymentId);
                  return (
                    <div key={vr.id} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #E8A33D", background: "#2B2416" }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>Mesa {payment?.tableIds.join(", ")} · {money(payment?.appliedAmount ?? 0)}</div>
                      <div style={{ fontSize: 11, color: "#9C948A", margin: "4px 0" }}>{vr.reason}</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => resolveVoidRequest(vr, "AUTHORIZED")} style={{ ...btnPrimary, flex: 1, padding: "6px 0", fontSize: 12 }}>Autorizar</button>
                        <button onClick={() => resolveVoidRequest(vr, "DENIED")} style={{ ...btnGhost, flex: 1, padding: "6px 0", fontSize: 12 }}>Denegar</button>
                      </div>
                    </div>
                  );
                })}
                {pendingAuthorizations.length === 0 && <div style={{ color: "#5A554C", fontSize: 12 }}>Sin solicitudes.</div>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Payment drawer */}
      {payDrawerOpen && (
        <div style={overlayStyle} onClick={() => setPayDrawerOpen(false)}>
          <div style={{ ...drawerStyle }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 12, color: "#9C948A", marginBottom: 4 }}>{cameraTableLabel}</div>
            <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 14 }}>{money(selectedRemaining)}</div>

            <label style={labelStyle}>EFECTIVO</label>
            <input value={cashInput} onChange={(e) => setCashInput(e.target.value.replace(/\D/g, ""))} style={inputStyle} />

            <label style={labelStyle}>TRANSFERENCIA</label>
            <input value={transferInput} onChange={(e) => setTransferInput(e.target.value.replace(/\D/g, ""))} style={inputStyle} />

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginTop: 10, color: "#9C948A" }}>
              <span>Aplicado</span><span>{money(appliedPreview)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: changeValid ? "#8FBF8A" : "#D98A6E" }}>
              <span>Cambio</span><span>{money(changePreview)}</span>
            </div>
            {!changeValid && <div style={{ color: "#D98A6E", fontSize: 12, marginTop: 4 }}>El cambio no puede exceder el efectivo recibido.</div>}

            <button onClick={confirmPayment} disabled={tenderedTotal <= 0 || !changeValid} style={{ ...btnPrimary, width: "100%", marginTop: 14, opacity: tenderedTotal > 0 && changeValid ? 1 : 0.4 }}>
              CONFIRMAR COBRO
            </button>
          </div>
        </div>
      )}

      {/* Close cash session modal */}
      {closeModalOpen && (
        <div style={overlayStyle} onClick={() => setCloseModalOpen(false)}>
          <div style={drawerStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Cuadre de caja</div>
            <div style={{ fontSize: 13, color: "#9C948A", marginBottom: 10 }}>Esperado: {money(expectedCash)}</div>
            <label style={labelStyle}>EFECTIVO CONTADO</label>
            <input value={countedCash} onChange={(e) => setCountedCash(e.target.value.replace(/\D/g, ""))} style={inputStyle} />
            {countedCash && (
              <div style={{ fontSize: 14, marginTop: 8, color: Number(countedCash) === expectedCash ? "#8FBF8A" : "#D98A6E" }}>
                Diferencia: {money(Number(countedCash) - expectedCash)}
              </div>
            )}
            <button
              onClick={() => {
                setSessionStatus("CLOSED");
                setCloseModalOpen(false);
              }}
              style={{ ...btnPrimary, width: "100%", marginTop: 14 }}
            >
              CERRAR CAJA
            </button>
          </div>
        </div>
      )}

      {/* Ticket confirmation */}
      {ticket && (
        <div style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", width: "min(320px, 90vw)", background: "#F5F1EA", color: "#1C1A17", borderRadius: "0 0 12px 12px", padding: "18px 20px 20px", boxShadow: "0 12px 30px rgba(0,0,0,0.4)", animation: "ticketDrop 0.35s ease-out", zIndex: 20, fontFamily: "ui-monospace, monospace" }}>
          <style>{`@keyframes ticketDrop { from { transform: translate(-50%, -100%); } to { transform: translate(-50%, 0); } }`}</style>
          <div style={{ fontSize: 11, letterSpacing: 1, opacity: 0.7, marginBottom: 6 }}>COBRADO</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{ticket.table}</div>
          <div style={{ fontSize: 14, marginTop: 2 }}>
            Aplicado {money(ticket.applied)}{ticket.change > 0 ? ` · Cambio ${money(ticket.change)}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}

const btnPrimary: React.CSSProperties = { background: "#E8A33D", color: "#1C1A17", border: "none", borderRadius: 10, padding: "12px 0", fontWeight: 800, fontSize: 14, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "transparent", color: "#9C948A", border: "1px solid #33302A", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" };
const btnDanger: React.CSSProperties = { background: "#B3452F", color: "#F5F1EA", border: "none", borderRadius: 8, padding: "8px 0", fontWeight: 700, fontSize: 12, cursor: "pointer" };
const overlayStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 30 };
const drawerStyle: React.CSSProperties = { background: "#1C1A17", borderTop: "1px solid #33302A", borderRadius: "16px 16px 0 0", padding: "20px", width: "min(420px, 100vw)" };
const labelStyle: React.CSSProperties = { fontSize: 11, color: "#9C948A", fontWeight: 600, letterSpacing: 0.4, display: "block", marginTop: 8, marginBottom: 4 };
const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#26221D", border: "1px solid #33302A", borderRadius: 8, color: "#F5F1EA", padding: "10px 12px", fontSize: 16, fontWeight: 700 };
