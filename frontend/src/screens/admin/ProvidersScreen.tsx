import React, { useEffect, useState } from "react";
import { Session } from "../../types";
import { apiFetch, genIdempotencyKey, money } from "../../lib/api";
import { colors, btnPrimary, inputStyle, btnGhost } from "../../lib/theme";

interface SupplierBalance {
  supplierId: string;
  name: string;
  outstandingBalance: string;
}

/**
 * Proveedores y compras (rutas /suppliers/*). No existe un GET /suppliers
 * que liste todos — el backend solo expone balances de los que tienen
 * saldo pendiente (/reports/payables) y consulta por id individual, así
 * que la lista de "conocidos" que se muestra aquí sale de ese reporte.
 */
export default function ProvidersScreen({ session }: { session: Session }) {
  const [suppliers, setSuppliers] = useState<SupplierBalance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Nueva compra
  const [supplierMode, setSupplierMode] = useState<"existing" | "new">("new");
  const [existingId, setExistingId] = useState("");
  const [newName, setNewName] = useState("");
  const [paymentTerms, setPaymentTerms] = useState<"contado" | "semanal" | "quincenal">("contado");
  const [amount, setAmount] = useState("");

  // Abono a proveedor
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payCash, setPayCash] = useState("");
  const [payTransfer, setPayTransfer] = useState("");

  const load = async () => {
    try {
      const r = await apiFetch(session, "/reports/payables");
      setSuppliers(r.suppliers);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error cargando proveedores");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const registerPurchase = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const supplier =
        supplierMode === "existing" ? { id: existingId.trim() } : { name: newName.trim(), paymentTerms };
      await apiFetch(session, "/suppliers/purchases", {
        method: "POST",
        body: JSON.stringify({ supplier, amount, idempotencyKey: genIdempotencyKey() }),
      });
      setMsg({ ok: true, text: "Compra registrada." });
      setAmount("");
      setNewName("");
      setExistingId("");
      await load();
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
    }
  };

  const registerPayment = async (supplierId: string) => {
    setLoading(true);
    setMsg(null);
    try {
      const tenders = [];
      if (Number(payCash) > 0) tenders.push({ method: "efectivo", amount: payCash });
      if (Number(payTransfer) > 0) tenders.push({ method: "transferencia", amount: payTransfer });
      await apiFetch(session, `/suppliers/${supplierId}/payments`, {
        method: "POST",
        body: JSON.stringify({ tenders, idempotencyKey: genIdempotencyKey() }),
      });
      setMsg({ ok: true, text: "Abono registrado." });
      setPayingId(null);
      setPayCash("");
      setPayTransfer("");
      await load();
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 480, margin: "0 auto" }}>
      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>REGISTRAR COMPRA</div>
      <div style={{ padding: 14, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.surface, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button onClick={() => setSupplierMode("new")} style={supplierMode === "new" ? btnPrimary : btnGhost}>
            Proveedor nuevo
          </button>
          <button onClick={() => setSupplierMode("existing")} style={supplierMode === "existing" ? btnPrimary : btnGhost}>
            Ya existe
          </button>
        </div>

        {supplierMode === "new" ? (
          <>
            <input placeholder="Nombre del proveedor" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
            <select
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value as "contado" | "semanal" | "quincenal")}
              style={{ ...inputStyle, marginBottom: 8 }}
            >
              <option value="contado">Contado</option>
              <option value="semanal">Semanal</option>
              <option value="quincenal">Quincenal</option>
            </select>
          </>
        ) : (
          <select value={existingId} onChange={(e) => setExistingId(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }}>
            <option value="">Selecciona un proveedor</option>
            {suppliers.map((s) => (
              <option key={s.supplierId} value={s.supplierId}>
                {s.name}
              </option>
            ))}
          </select>
        )}

        <input
          placeholder="Monto de la compra"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          style={{ ...inputStyle, marginBottom: 10 }}
        />
        <button
          onClick={registerPurchase}
          disabled={loading || !amount || (supplierMode === "new" ? !newName : !existingId)}
          style={{ ...btnPrimary, width: "100%" }}
        >
          {loading ? "GUARDANDO…" : "REGISTRAR COMPRA"}
        </button>
      </div>

      {msg && (
        <div style={{ padding: 10, borderRadius: 8, marginBottom: 14, background: msg.ok ? "#1E2A1D" : "#2A1D1A", color: msg.ok ? colors.success : colors.dangerText, fontSize: 13 }}>
          {msg.text}
        </div>
      )}
      {error && <div style={{ color: colors.dangerText, fontSize: 13, marginBottom: 14 }}>{error}</div>}

      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>SALDOS PENDIENTES ({suppliers.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {suppliers.map((s) => (
          <div key={s.supplierId} style={{ padding: 12, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.surface }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginBottom: 8 }}>
              <span>{s.name}</span>
              <span style={{ color: colors.dangerText }}>{money(s.outstandingBalance)}</span>
            </div>
            {payingId === s.supplierId ? (
              <div>
                <input
                  placeholder="Efectivo"
                  value={payCash}
                  onChange={(e) => setPayCash(e.target.value.replace(/[^\d.]/g, ""))}
                  style={{ ...inputStyle, marginBottom: 6 }}
                />
                <input
                  placeholder="Transferencia"
                  value={payTransfer}
                  onChange={(e) => setPayTransfer(e.target.value.replace(/[^\d.]/g, ""))}
                  style={{ ...inputStyle, marginBottom: 8 }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => registerPayment(s.supplierId)} disabled={loading} style={{ ...btnPrimary, flex: 1 }}>
                    Confirmar abono
                  </button>
                  <button onClick={() => setPayingId(null)} style={btnGhost}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setPayingId(s.supplierId)} style={{ ...btnGhost, width: "100%" }}>
                Abonar
              </button>
            )}
          </div>
        ))}
        {suppliers.length === 0 && <div style={{ color: colors.textDim, fontSize: 13 }}>Sin saldos pendientes.</div>}
      </div>
    </div>
  );
}
