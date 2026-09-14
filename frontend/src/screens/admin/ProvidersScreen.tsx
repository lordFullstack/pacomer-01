import React, { useEffect, useMemo, useState } from "react";
import { Session } from "../../types";
import { apiFetch, genIdempotencyKey, money } from "../../lib/api";
import { colors, btnPrimary, inputStyle, btnGhost } from "../../lib/theme";

interface SupplierBalance {
  supplierId: string;
  name: string;
  outstandingBalance: string;
}
interface SupplierStatement {
  supplier: { id: string; name: string; paymentTerms: "contado" | "semanal" | "quincenal"; createdAt: string };
  outstandingBalance: string;
  purchases: Array<{ id: string; amount: string; createdAt: string }>;
  payments: Array<{ id: string; appliedAmount: string; createdAt: string }>;
}

const statementRow: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: `1px solid ${colors.border}` };

/**
 * Proveedores y compras (rutas /suppliers/*). No existe un GET /suppliers
 * que liste todos — el backend solo expone balances de los que tienen
 * saldo pendiente (/reports/payables) y consulta por id individual, así
 * que la lista de "conocidos" que se muestra aquí sale de ese reporte.
 * Al seleccionar un proveedor se pide su estado de cuenta completo
 * (GET /suppliers/:id) para ver historial de compras y abonos.
 */
export default function ProvidersScreen({ session }: { session: Session }) {
  const [suppliers, setSuppliers] = useState<SupplierBalance[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statement, setStatement] = useState<SupplierStatement | null>(null);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);

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

  const filtered = useMemo(
    () => suppliers.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase())),
    [suppliers, query]
  );

  const openStatement = async (id: string) => {
    setSelectedId(id);
    setStatement(null);
    setStatementError(null);
    setStatementLoading(true);
    try {
      const s = await apiFetch(session, `/suppliers/${id}`);
      setStatement(s);
    } catch (e: unknown) {
      setStatementError(e instanceof Error ? e.message : "No se pudo cargar el estado de cuenta");
    } finally {
      setStatementLoading(false);
    }
  };
  const closeStatement = () => setSelectedId(null);

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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: colors.textMuted }}>SALDOS PENDIENTES ({filtered.length})</div>
        <button onClick={load} style={{ ...btnGhost, padding: "4px 8px" }}>
          Actualizar
        </button>
      </div>
      <input
        placeholder="Buscar proveedor por nombre…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ ...inputStyle, marginBottom: 12 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((s) => (
          <div key={s.supplierId} style={{ padding: 12, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.surface }}>
            <button
              onClick={() => openStatement(s.supplierId)}
              style={{ background: "none", border: "none", padding: 0, width: "100%", cursor: "pointer", display: "flex", justifyContent: "space-between", fontWeight: 700, marginBottom: 8, color: colors.text, textAlign: "left" }}
            >
              <span>{s.name}</span>
              <span style={{ color: colors.dangerText }}>{money(s.outstandingBalance)}</span>
            </button>
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
        {filtered.length === 0 && <div style={{ color: colors.textDim, fontSize: 13 }}>Sin saldos pendientes.</div>}
      </div>

      {selectedId && (
        <div
          onClick={closeStatement}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 10 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ padding: 14, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.surface, width: "min(440px, 100%)", maxHeight: "85vh", overflowY: "auto" }}
          >
            {statementLoading && <div style={{ color: colors.textDim, fontSize: 13 }}>Cargando estado de cuenta…</div>}
            {statementError && <div style={{ color: colors.dangerText, fontSize: 13 }}>{statementError}</div>}
            {statement && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{statement.supplier.name}</div>
                    <div style={{ fontSize: 12, color: colors.textMuted, textTransform: "capitalize" }}>Términos de pago: {statement.supplier.paymentTerms}</div>
                  </div>
                  <button onClick={closeStatement} style={btnGhost}>
                    Cerrar
                  </button>
                </div>

                <div style={{ padding: 10, borderRadius: 8, background: colors.bg, border: `1px solid ${colors.border}`, marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>Saldo pendiente</div>
                  <div style={{ fontWeight: 800, color: Number(statement.outstandingBalance) > 0 ? colors.dangerText : colors.success }}>
                    {money(statement.outstandingBalance)}
                  </div>
                </div>

                <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>HISTORIAL DE COMPRAS ({statement.purchases.length})</div>
                <div style={{ marginBottom: 14 }}>
                  {statement.purchases.map((p) => (
                    <div key={p.id} style={statementRow}>
                      <span style={{ color: colors.textMuted }}>{new Date(p.createdAt).toLocaleDateString("es-CO")}</span>
                      <span>{money(p.amount)}</span>
                    </div>
                  ))}
                  {statement.purchases.length === 0 && <div style={{ color: colors.textDim, fontSize: 12 }}>Sin compras.</div>}
                </div>

                <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>HISTORIAL DE ABONOS ({statement.payments.length})</div>
                <div>
                  {statement.payments.map((p) => (
                    <div key={p.id} style={statementRow}>
                      <span style={{ color: colors.textMuted }}>{new Date(p.createdAt).toLocaleDateString("es-CO")}</span>
                      <span style={{ color: colors.success }}>{money(p.appliedAmount)}</span>
                    </div>
                  ))}
                  {statement.payments.length === 0 && <div style={{ color: colors.textDim, fontSize: 12 }}>Sin abonos.</div>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
