import React, { useState, useEffect, useRef } from "react";
import { Session } from "../types";
import { apiFetch, genIdempotencyKey } from "../lib/api";
import { colors, btnPrimary, inputStyle } from "../lib/theme";

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
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [tables, setTables] = useState<Array<{ id: string; label: string }>>([]);
  const currentKeyRef = useRef<string | null>(null);

  useEffect(() => {
    apiFetch(session, "/tables")
      .then((r) => setTables(r.tables))
      .catch(() => {});
  }, [session]);

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
          idempotencyKey: currentKeyRef.current,
        }),
      });
      setFeedback({ ok: true, text: `Registrado — obligación ${out.obligationId.slice(0, 8)}…` });
      setAmount("");
      setName("");
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
      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>
        MESA
      </div>
      <select
        value={tableId}
        onChange={(e) => setTableId(e.target.value)}
        style={{ ...inputStyle, marginBottom: 14 }}
      >
        <option value="">— elige mesa —</option>
        {tables.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
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

      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (opcional)" style={{ ...inputStyle, marginBottom: 14 }} />
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
        placeholder="Valor"
        style={{ ...inputStyle, marginBottom: 14, fontSize: 20, fontWeight: 800 }}
      />

      <button onClick={submit} disabled={submitting || !tableId || !amount} style={{ ...btnPrimary, width: "100%", opacity: submitting ? 0.6 : 1 }}>
        {submitting ? "REGISTRANDO…" : "REGISTRAR"}
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