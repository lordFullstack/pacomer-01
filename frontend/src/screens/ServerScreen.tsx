import React, { useState, useEffect, useRef } from "react";
import { Session } from "../types";
import { apiFetch, genIdempotencyKey } from "../lib/api";
import { colors, btnPrimary, btnGhost, inputStyle } from "../lib/theme";

/**
 * LOOP 06 — Frontend Servidor.
 * 04_UX_SERVER.md KPI: registro en <=3s, cero navegación, volver de
 * inmediato a "¿quién sigue?". Talks to the real POST /service-line/diners.
 */
export default function ServerScreen({ session }: { session: Session }) {
  const [amount, setAmount] = useState("");
  const [tableId, setTableId] = useState("");
  const [paymentMode, setPaymentMode] = useState<"individual" | "conjunto">("individual");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [tables, setTables] = useState<Array<{ id: string; label: string; hasOpenAccount: boolean }>>([]);
  const currentKeyRef = useRef<string | null>(null);

  useEffect(() => {
    apiFetch(session, "/tables")
      .then((r) => setTables(r.tables))
      .catch(() => {});
  }, [session]);

  const reset = () => {
    setTableId("");
    setAmount("");
    setName("");
    setNote("");
    setPaymentMode("individual");
  };

  const submit = async () => {
    if (!tableId || !amount) return;
    if (!currentKeyRef.current) currentKeyRef.current = genIdempotencyKey();
    setSubmitting(true);
    try {
      const out = await apiFetch(session, "/service-line/diners", {
        method: "POST",
        body: JSON.stringify({
          tableId,
          amount,
          paymentMode,
          name: name || undefined,
          descriptor: note || undefined,
          idempotencyKey: currentKeyRef.current,
        }),
      });
      setFeedback({ ok: true, text: `Registrado — obligación ${out.obligationId.slice(0, 8)}…` });
      reset();
      currentKeyRef.current = null;
    } catch (e: unknown) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setSubmitting(false);
      setTimeout(() => setFeedback(null), 2500);
    }
  };

  const sectionLabel: React.CSSProperties = { fontSize: 11, color: colors.textMuted, marginBottom: 4, letterSpacing: 0.5 };

  return (
    <div
      style={{
        height: "100%",
        boxSizing: "border-box",
        padding: "10px 16px 12px",
        maxWidth: 420,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div>
        <div style={sectionLabel}>MESA</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))",
            gap: 6,
          }}
        >
          {tables.map((t) => {
            const selected = t.id === tableId;
            return (
              <button
                key={t.id}
                onClick={() => setTableId(t.id)}
                style={{
                  padding: "6px 2px",
                  borderRadius: 6,
                  border: selected ? `2px solid ${colors.accent}` : "1px solid transparent",
                  background: t.hasOpenAccount ? colors.success : colors.surface,
                  color: t.hasOpenAccount ? colors.bg : colors.text,
                  fontWeight: 700,
                  fontSize: 12,
                  lineHeight: 1.2,
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {(["individual", "conjunto"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setPaymentMode(m)}
            style={{
              flex: 1,
              padding: 8,
              borderRadius: 8,
              border: paymentMode === m ? `2px solid ${colors.secondary}` : `1px solid ${colors.border}`,
              background: paymentMode === m ? colors.secondary : colors.surface,
              color: paymentMode === m ? colors.bg : colors.text,
              fontWeight: 700,
              fontSize: 13,
              textTransform: "capitalize",
            }}
          >
            {m}
          </button>
        ))}
      </div>

      <div>
        <div style={sectionLabel}>
          NOMBRE <span style={{ color: colors.textDim, fontWeight: 400 }}>(opcional)</span>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del comensal"
          style={{ ...inputStyle, padding: "8px 12px" }}
        />
      </div>

      <div>
        <div style={sectionLabel}>VALOR</div>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder="$0"
          style={{
            ...inputStyle,
            padding: "8px 12px",
            fontSize: 22,
            fontWeight: 800,
            textAlign: "right",
          }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={sectionLabel}>
          NOTA <span style={{ color: colors.textDim, fontWeight: 400 }}>(opcional)</span>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Sin sal, apurado…"
          style={{ ...inputStyle, padding: "8px 12px", resize: "none", fontFamily: "inherit", flex: 1, minHeight: 36 }}
        />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={reset} disabled={submitting} style={{ ...btnGhost, flex: 1, padding: "10px 0", fontSize: 14, fontWeight: 700 }}>
          Limpiar
        </button>
        <button onClick={submit} disabled={submitting || !tableId || !amount} style={{ ...btnPrimary, flex: 2, padding: "10px 0", opacity: submitting ? 0.6 : 1 }}>
          {submitting ? "REGISTRANDO…" : "✓ Registrar"}
        </button>
      </div>

      {feedback && (
        <div
          style={{
            padding: 8,
            borderRadius: 8,
            background: feedback.ok ? "#1E2A1D" : "#2A1D1A",
            color: feedback.ok ? colors.success : colors.dangerText,
            fontSize: 12,
          }}
        >
          {feedback.text}
        </div>
      )}
    </div>
  );
}
