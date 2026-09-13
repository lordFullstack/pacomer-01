import React, { useState } from "react";
import { Session } from "../../types";
import { apiFetch, genIdempotencyKey, money } from "../../lib/api";
import { colors, btnPrimary, inputStyle, btnGhost } from "../../lib/theme";

interface Receipt {
  id: string;
  sequentialNumber: number;
  obligationIds: string[];
  amount: string;
  customerName: string | null;
  customerIdNumber: string | null;
  issuedAt: string;
}

/**
 * Recibos (rutas /receipts/*). El backend exige que las cuentas ya estén
 * pagadas o fiadas (no PENDING) antes de emitir un recibo — no existe un
 * listado de "cuentas ya cobradas", así que aquí se ingresan los IDs de
 * obligación a mano (se ven, por ejemplo, en el ticket de cobro del
 * cajero). También permite buscar un recibo ya emitido por su ID.
 */
export default function ReceiptsScreen({ session }: { session: Session }) {
  const [obligationIdsRaw, setObligationIdsRaw] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerIdNumber, setCustomerIdNumber] = useState("");
  const [issued, setIssued] = useState<Receipt | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const [lookupId, setLookupId] = useState("");
  const [lookedUp, setLookedUp] = useState<Receipt | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const issue = async () => {
    setLoading(true);
    setMsg(null);
    setIssued(null);
    try {
      const obligationIds = obligationIdsRaw
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (obligationIds.length === 0) throw new Error("Ingresa al menos un ID de obligación");
      const out = await apiFetch(session, "/receipts", {
        method: "POST",
        body: JSON.stringify({
          obligationIds,
          customerName: customerName || undefined,
          customerIdNumber: customerIdNumber || undefined,
          idempotencyKey: genIdempotencyKey(),
        }),
      });
      setIssued(out);
      setMsg({ ok: true, text: `Recibo #${out.sequentialNumber} emitido.` });
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
    }
  };

  const lookup = async () => {
    setLookupError(null);
    setLookedUp(null);
    try {
      const r = await apiFetch(session, `/receipts/${lookupId.trim()}`);
      setLookedUp(r);
    } catch (e: unknown) {
      setLookupError(e instanceof Error ? e.message : "No encontrado");
    }
  };

  const renderReceipt = (r: Receipt) => (
    <div style={{ padding: 16, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.surface, fontFamily: "monospace" }}>
      <div style={{ textAlign: "center", fontWeight: 800, marginBottom: 8 }}>RECIBO #{r.sequentialNumber}</div>
      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4 }}>{new Date(r.issuedAt).toLocaleString("es-CO")}</div>
      {r.customerName && <div style={{ fontSize: 13, marginBottom: 2 }}>Cliente: {r.customerName}</div>}
      {r.customerIdNumber && <div style={{ fontSize: 13, marginBottom: 8 }}>NIT/CC: {r.customerIdNumber}</div>}
      <div style={{ borderTop: `1px dashed ${colors.border}`, marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", fontWeight: 800 }}>
        <span>TOTAL</span>
        <span>{money(r.amount)}</span>
      </div>
      <div style={{ fontSize: 11, color: colors.textDim, marginTop: 8 }}>Comprobante operativo — no es factura fiscal.</div>
    </div>
  );

  return (
    <div style={{ padding: 20, maxWidth: 480, margin: "0 auto" }}>
      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>EMITIR RECIBO</div>
      <div style={{ padding: 14, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.surface, marginBottom: 16 }}>
        <textarea
          placeholder="ID(s) de obligación, separados por coma"
          value={obligationIdsRaw}
          onChange={(e) => setObligationIdsRaw(e.target.value)}
          style={{ ...inputStyle, marginBottom: 8, minHeight: 60, fontFamily: "monospace", fontSize: 12 }}
        />
        <input placeholder="Nombre del cliente (opcional)" value={customerName} onChange={(e) => setCustomerName(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
        <input placeholder="Cédula/NIT (opcional)" value={customerIdNumber} onChange={(e) => setCustomerIdNumber(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }} />
        <button onClick={issue} disabled={loading || !obligationIdsRaw.trim()} style={{ ...btnPrimary, width: "100%" }}>
          {loading ? "EMITIENDO…" : "EMITIR RECIBO"}
        </button>
      </div>

      {msg && (
        <div style={{ padding: 10, borderRadius: 8, marginBottom: 14, background: msg.ok ? "#1E2A1D" : "#2A1D1A", color: msg.ok ? colors.success : colors.dangerText, fontSize: 13 }}>
          {msg.text}
        </div>
      )}
      {issued && <div style={{ marginBottom: 20 }}>{renderReceipt(issued)}</div>}

      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>BUSCAR RECIBO EMITIDO</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input placeholder="ID del recibo" value={lookupId} onChange={(e) => setLookupId(e.target.value)} style={inputStyle} />
        <button onClick={lookup} disabled={!lookupId.trim()} style={btnGhost}>
          Buscar
        </button>
      </div>
      {lookupError && <div style={{ color: colors.dangerText, fontSize: 13, marginBottom: 10 }}>{lookupError}</div>}
      {lookedUp && renderReceipt(lookedUp)}
    </div>
  );
}
