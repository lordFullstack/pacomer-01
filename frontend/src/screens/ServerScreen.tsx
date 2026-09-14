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

  return (
    <div style={{ padding: 20, maxWidth: 420, margin: "0 auto" }}>
      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8, letterSpacing: 0.5 }}>
        MESA
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))",
          gap: 8,
          marginBottom: 16,
        }}
      >
        {tables.map((t) => {
          const selected = t.id === tableId;
          return (
            <button
              key={t.id}
              onClick={() => setTableId(t.id)}
              style={{
                aspectRatio: "1 / 1",
                borderRadius: 8,
                border: selected ? `2px solid ${colors.accent}` : "1px solid transparent",
                background: t.hasOpenAccount ? colors.success : colors.surface,
                color: t.hasOpenAccount ? colors.bg : colors.text,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["individual", "conjunto"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setPaymentMode(m)}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 8,
              border: paymentMode === m ? `2px solid ${colors.secondary}` : `1px solid ${colors.border}`,
              background: paymentMode === m ? colors.secondary : colors.surface,
              color: paymentMode === m ? colors.bg : colors.text,
              fontWeight: 700,
              textTransform: "capitalize",
            }}
          >
            {m}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8, letterSpacing: 0.5 }}>
        VALOR
      </div>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
        placeholder="$0"
        style={{
          ...inputStyle,
          marginBottom: 16,
          fontSize: 24,
          fontWeight: 800,
          textAlign: "right",
        }}
      />

      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8, letterSpacing: 0.5 }}>
        NOTA <span style={{ color: colors.textDim, fontWeight: 400 }}>(opcional)</span>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Sin sal, apurado…"
        rows={3}
        style={{ ...inputStyle, marginBottom: 24, resize: "none", fontFamily: "inherit" }}
      />

      <button onClick={submit} disabled={submitting || !tableId || !amount} style={{ ...btnPrimary, width: "100%", opacity: submitting ? 0.6 : 1, marginBottom: 10 }}>
        {submitting ? "REGISTRANDO…" : "✓ Registrar"}
      </button>
      <button onClick={reset} disabled={submitting} style={{ ...btnGhost, width: "100%", padding: "12px 0", fontSize: 14, fontWeight: 700 }}>
        Limpiar
      </button>

      {feedback && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 8,
            background: feedback.ok ? "#1E2A1D" : "#2A1D1A",
            color: feedback.ok ? colors.success : colors.dangerText,
            fontSize: 13,
          }}
        >
          {feedback.text}
        </div>
      )}
    </div>
  );
}
