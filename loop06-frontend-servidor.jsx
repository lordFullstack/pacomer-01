import React, { useState, useRef, useCallback, useEffect } from "react";

/**
 * LOOP 06 — Frontend Servidor
 *
 * KPI (04_UX_SERVER.md): registro en <=3s, cero navegación, el servidor
 * debe poder registrar y volver de inmediato a "¿quién sigue?".
 *
 * Design intent: this is a tool gripped mid-motion at a breakfast counter,
 * often in direct morning glare through a storefront window — so it leans
 * dark/high-contrast rather than a bright dashboard, with one confident
 * "confirm" amber (griddle/eggs-over-easy) and everything else quiet.
 * The confirmation is a ticket-stamp: a torn order-ticket slides down,
 * stamps, and clears itself — evoking a kitchen ticket rail, which is the
 * one signature moment; everything else stays disciplined.
 */

const TABLE_COUNT = 14;

type PaymentMode = "individual" | "conjunto";
type ConnState = "online" | "offline";

interface PendingSubmission {
  idempotencyKey: string;
  tableId: number;
  paymentMode: PaymentMode;
  amount: string;
  name?: string;
  descriptor?: string;
}

interface TicketEntry {
  id: string;
  tableId: number;
  amount: string;
  paymentMode: PaymentMode;
  name?: string;
  status: "queued" | "confirmed" | "failed";
}

function genIdempotencyKey(): string {
  return `srv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Mock of POST /service-line/diners (LOOP 05). Simulates latency and
 * occasional transient failure so the retry path is demonstrable. A real
 * deployment points this at the backend built in LOOP 05.
 */
async function mockRegisterDiner(
  payload: PendingSubmission,
  seenKeys: Set<string>,
  simulateOffline: boolean
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (simulateOffline) {
    return { ok: false, reason: "offline" };
  }
  await new Promise((r) => setTimeout(r, 450 + Math.random() * 350));

  if (seenKeys.has(payload.idempotencyKey)) {
    // Same idempotency key replayed (double-tap / retry) -> treated as the
    // original success, never a duplicate row. Mirrors LOOP 05 behavior.
    return { ok: true };
  }
  seenKeys.add(payload.idempotencyKey);
  return { ok: true };
}

export default function ServerRegistrationScreen() {
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("individual");
  const [amount, setAmount] = useState<string>("");
  const [name, setName] = useState("");
  const [descriptor, setDescriptor] = useState("");
  const [showOptional, setShowOptional] = useState(false);

  const [conn, setConn] = useState<ConnState>("online");
  const [submitting, setSubmitting] = useState(false);
  const [ticket, setTicket] = useState<TicketEntry | null>(null);
  const [recentCount, setRecentCount] = useState(0);

  const seenKeysRef = useRef<Set<string>>(new Set());
  const currentKeyRef = useRef<string | null>(null);
  const retryQueueRef = useRef<PendingSubmission[]>([]);

  const resetForm = useCallback(() => {
    setSelectedTable(null);
    setAmount("");
    setName("");
    setDescriptor("");
    setShowOptional(false);
    currentKeyRef.current = null;
  }, []);

  const attemptSubmit = useCallback(
    async (payload: PendingSubmission) => {
      setSubmitting(true);
      const result = await mockRegisterDiner(payload, seenKeysRef.current, conn === "offline");

      if (result.ok) {
        setTicket({
          id: payload.idempotencyKey,
          tableId: payload.tableId,
          amount: payload.amount,
          paymentMode: payload.paymentMode,
          name: payload.name,
          status: "confirmed",
        });
        setRecentCount((c) => c + 1);
        setSubmitting(false);
        resetForm();
        window.setTimeout(() => setTicket(null), 1800);
      } else {
        // Reintento seguro: same idempotency key, queued, no duplicate risk.
        retryQueueRef.current.push(payload);
        setTicket({
          id: payload.idempotencyKey,
          tableId: payload.tableId,
          amount: payload.amount,
          paymentMode: payload.paymentMode,
          name: payload.name,
          status: "failed",
        });
        setSubmitting(false);
      }
    },
    [conn, resetForm]
  );

  // Auto-flush the retry queue whenever connection comes back.
  useEffect(() => {
    if (conn === "online" && retryQueueRef.current.length > 0) {
      const queued = [...retryQueueRef.current];
      retryQueueRef.current = [];
      queued.forEach((p) => void attemptSubmit(p));
    }
  }, [conn, attemptSubmit]);

  const canSubmit = selectedTable !== null && amount.length > 0 && Number(amount) > 0 && !submitting;

  const handleSubmit = () => {
    if (!canSubmit || selectedTable === null) return;
    // Double-tap guard: reuse the same idempotency key if a submit for this
    // exact form state is already in flight/queued.
    if (!currentKeyRef.current) {
      currentKeyRef.current = genIdempotencyKey();
    }
    const payload: PendingSubmission = {
      idempotencyKey: currentKeyRef.current,
      tableId: selectedTable,
      paymentMode,
      amount,
      name: name || undefined,
      descriptor: descriptor || undefined,
    };
    void attemptSubmit(payload);
  };

  const pressDigit = (d: string) => {
    if (d === "back") {
      setAmount((a) => a.slice(0, -1));
      return;
    }
    if (d === "." && amount.includes(".")) return;
    setAmount((a) => (a.length >= 9 ? a : a + d));
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#1C1A17",
        color: "#F5F1EA",
        fontFamily:
          "'Segoe UI', ui-sans-serif, system-ui, -apple-system, sans-serif",
        display: "flex",
        flexDirection: "column",
        userSelect: "none",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 18px",
          borderBottom: "1px solid #33302A",
        }}
      >
        <div style={{ fontWeight: 800, letterSpacing: 0.5, fontSize: 15 }}>
          FAST TRACK · SERVIDOR
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 12, color: "#9C948A" }}>
            {recentCount} registrados hoy
          </span>
          <button
            onClick={() => setConn((c) => (c === "online" ? "offline" : "online"))}
            title="Alternar conexión (demo)"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "1px solid #33302A",
              borderRadius: 999,
              padding: "5px 10px",
              cursor: "pointer",
              color: conn === "online" ? "#8FBF8A" : "#D98A6E",
              fontSize: 12,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: conn === "online" ? "#8FBF8A" : "#B3452F",
                display: "inline-block",
              }}
            />
            {conn === "online" ? "Conectado" : "Sin conexión"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, padding: "16px 18px 24px", maxWidth: 480, margin: "0 auto", width: "100%" }}>
        {/* Mesa quick-select */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, color: "#9C948A", marginBottom: 8, fontWeight: 600, letterSpacing: 0.4 }}>
            MESA
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
            {Array.from({ length: TABLE_COUNT }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setSelectedTable(n)}
                style={{
                  aspectRatio: "1",
                  borderRadius: 10,
                  border: selectedTable === n ? "2px solid #E8A33D" : "1px solid #33302A",
                  background: selectedTable === n ? "#E8A33D" : "#26221D",
                  color: selectedTable === n ? "#1C1A17" : "#F5F1EA",
                  fontSize: 18,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Individual / conjunto toggle */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, color: "#9C948A", marginBottom: 8, fontWeight: 600, letterSpacing: 0.4 }}>
            MODALIDAD
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["individual", "conjunto"] as PaymentMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setPaymentMode(m)}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 10,
                  border: paymentMode === m ? "2px solid #7A8B78" : "1px solid #33302A",
                  background: paymentMode === m ? "#7A8B78" : "#26221D",
                  color: paymentMode === m ? "#1C1A17" : "#F5F1EA",
                  fontWeight: 700,
                  fontSize: 14,
                  textTransform: "capitalize",
                  cursor: "pointer",
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Optional identifier - collapsed by default per 04_UX_SERVER.md */}
        <div style={{ marginBottom: 18 }}>
          {!showOptional ? (
            <button
              onClick={() => setShowOptional(true)}
              style={{
                background: "none",
                border: "none",
                color: "#9C948A",
                fontSize: 13,
                cursor: "pointer",
                padding: 0,
                textDecoration: "underline",
              }}
            >
              + nombre o característica (opcional)
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre"
                style={{
                  flex: 1,
                  background: "#26221D",
                  border: "1px solid #33302A",
                  borderRadius: 8,
                  color: "#F5F1EA",
                  padding: "10px 12px",
                  fontSize: 14,
                }}
              />
              <input
                value={descriptor}
                onChange={(e) => setDescriptor(e.target.value)}
                placeholder="Característica"
                style={{
                  flex: 1,
                  background: "#26221D",
                  border: "1px solid #33302A",
                  borderRadius: 8,
                  color: "#F5F1EA",
                  padding: "10px 12px",
                  fontSize: 14,
                }}
              />
            </div>
          )}
        </div>

        {/* Value entry */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#9C948A", marginBottom: 8, fontWeight: 600, letterSpacing: 0.4 }}>
            VALOR
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 800,
              textAlign: "right",
              padding: "10px 6px",
              borderBottom: "2px solid #33302A",
              marginBottom: 10,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {amount ? `$${amount}` : <span style={{ color: "#5A554C" }}>$0</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"].map((k) => (
              <button
                key={k}
                onClick={() => pressDigit(k)}
                style={{
                  padding: "16px 0",
                  borderRadius: 10,
                  border: "1px solid #33302A",
                  background: "#26221D",
                  color: "#F5F1EA",
                  fontSize: 18,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {k === "back" ? "⌫" : k}
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            width: "100%",
            padding: "18px 0",
            borderRadius: 12,
            border: "none",
            background: canSubmit ? "#E8A33D" : "#3A362F",
            color: canSubmit ? "#1C1A17" : "#7A756C",
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: 0.3,
            cursor: canSubmit ? "pointer" : "not-allowed",
            marginTop: 4,
          }}
        >
          {submitting ? "REGISTRANDO…" : "REGISTRAR"}
        </button>
      </div>

      {/* Ticket-stamp confirmation overlay — the signature moment */}
      {ticket && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(320px, 90vw)",
            background: ticket.status === "confirmed" ? "#F5F1EA" : "#2A211D",
            color: ticket.status === "confirmed" ? "#1C1A17" : "#D98A6E",
            borderRadius: "0 0 12px 12px",
            padding: "18px 20px 20px",
            boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
            animation: "ticketDrop 0.35s ease-out",
            zIndex: 10,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          <style>{`
            @keyframes ticketDrop {
              from { transform: translate(-50%, -100%); }
              to { transform: translate(-50%, 0); }
            }
          `}</style>
          <div style={{ fontSize: 11, letterSpacing: 1, opacity: 0.7, marginBottom: 6 }}>
            {ticket.status === "confirmed" ? "REGISTRADO" : "SIN CONEXIÓN · EN COLA"}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>MESA {ticket.tableId}</div>
          <div style={{ fontSize: 14, marginTop: 2 }}>
            ${ticket.amount || "0"} · {ticket.paymentMode}
            {ticket.name ? ` · ${ticket.name}` : ""}
          </div>
          {ticket.status === "failed" && (
            <button
              onClick={() => setTicket(null)}
              style={{
                marginTop: 10,
                background: "none",
                border: "1px solid #4A3E36",
                color: "#D98A6E",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Se reintentará al reconectar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
