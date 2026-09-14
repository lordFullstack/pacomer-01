import React, { useEffect, useMemo, useState } from "react";
import { Session } from "../../types";
import { apiFetch, genIdempotencyKey, money } from "../../lib/api";
import { colors, btnPrimary, inputStyle, btnGhost } from "../../lib/theme";

interface CustomerBalance {
  customerId: string;
  name: string;
  outstandingBalance: string;
}
interface CustomerStatement {
  customer: {
    id: string;
    name: string;
    phone: string;
    type: "persona" | "empresa";
    creditLimit: string;
    createdAt: string;
  };
  outstandingBalance: string;
  credits: Array<{ id: string; obligationId: string; amount: string; createdAt: string }>;
  repayments: Array<{ id: string; appliedAmount: string; createdAt: string }>;
}

const card: React.CSSProperties = {
  padding: 14,
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  background: colors.surface,
};
const label: React.CSSProperties = { fontSize: 12, color: colors.textMuted, marginBottom: 8 };
const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: `1px solid ${colors.border}` };

/**
 * Clientes (directorio). No existe GET /customers en el backend — el
 * "universo" de clientes conocidos sale de /reports/customer-credits
 * (BR-019/09_CUSTOMER_CREDIT.md ya expone eso mismo en el reporte de
 * saldos), así que esta pantalla solo puede listar clientes con historial
 * de crédito. Al seleccionar uno se pide el estado de cuenta completo
 * (GET /credits/:id) para mostrar teléfono, tipo, límite e historial de
 * abonos — datos que existían en el backend pero ninguna pantalla usaba.
 */
export default function ClientsScreen({ session }: { session: Session }) {
  const [customers, setCustomers] = useState<CustomerBalance[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statement, setStatement] = useState<CustomerStatement | null>(null);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);

  const [payCash, setPayCash] = useState("");
  const [payTransfer, setPayTransfer] = useState("");
  const [payMsg, setPayMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [paying, setPaying] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const r = await apiFetch(session, "/reports/customer-credits");
      setCustomers(r.customers);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error cargando clientes");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => customers.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase())),
    [customers, query]
  );

  const openStatement = async (id: string) => {
    setSelectedId(id);
    setStatement(null);
    setStatementError(null);
    setPayMsg(null);
    setStatementLoading(true);
    try {
      const s = await apiFetch(session, `/credits/${id}`);
      setStatement(s);
    } catch (e: unknown) {
      setStatementError(e instanceof Error ? e.message : "No se pudo cargar el estado de cuenta");
    } finally {
      setStatementLoading(false);
    }
  };

  const close = () => {
    setSelectedId(null);
    setStatement(null);
    setPayCash("");
    setPayTransfer("");
  };

  const registerRepayment = async () => {
    if (!selectedId) return;
    setPaying(true);
    setPayMsg(null);
    try {
      const tenders = [];
      if (Number(payCash) > 0) tenders.push({ method: "efectivo", amount: payCash });
      if (Number(payTransfer) > 0) tenders.push({ method: "transferencia", amount: payTransfer });
      if (tenders.length === 0) throw new Error("Ingresa al menos un monto");
      await apiFetch(session, `/credits/${selectedId}/repayments`, {
        method: "POST",
        body: JSON.stringify({ tenders, idempotencyKey: genIdempotencyKey() }),
      });
      setPayMsg({ ok: true, text: "Abono registrado." });
      setPayCash("");
      setPayTransfer("");
      await Promise.all([load(), openStatement(selectedId)]);
    } catch (e: unknown) {
      setPayMsg({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setPaying(false);
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 560, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: colors.textMuted }}>CLIENTES ({filtered.length})</div>
        <button onClick={load} style={{ ...btnGhost, padding: "4px 8px" }}>
          Actualizar
        </button>
      </div>
      <input
        placeholder="Buscar cliente por nombre…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ ...inputStyle, marginBottom: 12 }}
      />

      {error && <div style={{ color: colors.dangerText, fontSize: 13, marginBottom: 12 }}>{error}</div>}
      <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 14 }}>
        Solo se listan clientes con crédito registrado alguna vez. Para dar de alta uno nuevo, usa la pestaña "Créditos" al fiar una cuenta.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((c) => (
          <button
            key={c.customerId}
            onClick={() => openStatement(c.customerId)}
            style={{ ...card, textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <span style={{ fontWeight: 700 }}>{c.name}</span>
            <span style={{ color: Number(c.outstandingBalance) > 0 ? colors.dangerText : colors.success, fontWeight: 700 }}>
              {money(c.outstandingBalance)}
            </span>
          </button>
        ))}
        {filtered.length === 0 && !error && <div style={{ color: colors.textDim, fontSize: 13 }}>Sin clientes que coincidan.</div>}
      </div>

      {selectedId && (
        <div
          onClick={close}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 10 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ ...card, width: "min(440px, 100%)", maxHeight: "85vh", overflowY: "auto" }}
          >
            {statementLoading && <div style={{ color: colors.textDim, fontSize: 13 }}>Cargando estado de cuenta…</div>}
            {statementError && <div style={{ color: colors.dangerText, fontSize: 13 }}>{statementError}</div>}
            {statement && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{statement.customer.name}</div>
                    <div style={{ fontSize: 12, color: colors.textMuted, textTransform: "capitalize" }}>
                      {statement.customer.type} · {statement.customer.phone}
                    </div>
                  </div>
                  <button onClick={close} style={btnGhost}>
                    Cerrar
                  </button>
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  <div style={{ flex: 1, padding: 10, borderRadius: 8, background: colors.bg, border: `1px solid ${colors.border}` }}>
                    <div style={{ fontSize: 11, color: colors.textMuted }}>Saldo pendiente</div>
                    <div style={{ fontWeight: 800, color: Number(statement.outstandingBalance) > 0 ? colors.dangerText : colors.success }}>
                      {money(statement.outstandingBalance)}
                    </div>
                  </div>
                  <div style={{ flex: 1, padding: 10, borderRadius: 8, background: colors.bg, border: `1px solid ${colors.border}` }}>
                    <div style={{ fontSize: 11, color: colors.textMuted }}>Límite de crédito</div>
                    <div style={{ fontWeight: 800 }}>{money(statement.customer.creditLimit)}</div>
                  </div>
                </div>

                {Number(statement.outstandingBalance) > 0 && (
                  <div style={{ padding: 12, borderRadius: 8, border: `1px solid ${colors.border}`, marginBottom: 14 }}>
                    <div style={{ ...label, marginBottom: 6 }}>REGISTRAR ABONO</div>
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
                    <button onClick={registerRepayment} disabled={paying} style={{ ...btnPrimary, width: "100%" }}>
                      {paying ? "GUARDANDO…" : "CONFIRMAR ABONO"}
                    </button>
                    {payMsg && (
                      <div style={{ marginTop: 8, fontSize: 12, color: payMsg.ok ? colors.success : colors.dangerText }}>{payMsg.text}</div>
                    )}
                  </div>
                )}

                <div style={label}>HISTORIAL DE CRÉDITOS ({statement.credits.length})</div>
                <div style={{ marginBottom: 14 }}>
                  {statement.credits.map((c) => (
                    <div key={c.id} style={row}>
                      <span style={{ color: colors.textMuted }}>{new Date(c.createdAt).toLocaleDateString("es-CO")}</span>
                      <span>{money(c.amount)}</span>
                    </div>
                  ))}
                  {statement.credits.length === 0 && <div style={{ color: colors.textDim, fontSize: 12 }}>Sin créditos.</div>}
                </div>

                <div style={label}>HISTORIAL DE ABONOS ({statement.repayments.length})</div>
                <div>
                  {statement.repayments.map((r) => (
                    <div key={r.id} style={row}>
                      <span style={{ color: colors.textMuted }}>{new Date(r.createdAt).toLocaleDateString("es-CO")}</span>
                      <span style={{ color: colors.success }}>{money(r.appliedAmount)}</span>
                    </div>
                  ))}
                  {statement.repayments.length === 0 && <div style={{ color: colors.textDim, fontSize: 12 }}>Sin abonos.</div>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
