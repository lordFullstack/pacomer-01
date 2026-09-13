import React, { useEffect, useState } from "react";
import { Session } from "../../types";
import { apiFetch, money } from "../../lib/api";
import { colors } from "../../lib/theme";

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

const card: React.CSSProperties = {
  padding: 14,
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  marginBottom: 14,
};
const label: React.CSSProperties = { fontSize: 12, color: colors.textMuted, marginBottom: 8 };

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

  const load = async () => {
    setError(null);
    try {
      const [s, c, cr, p] = await Promise.all([
        apiFetch(session, `/reports/daily-sales?date=${date}`),
        apiFetch(session, "/reports/cash-status"),
        apiFetch(session, "/reports/customer-credits"),
        apiFetch(session, "/reports/payables"),
      ]);
      setSales(s);
      setCash(c);
      setCredits(cr);
      setPayables(p);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error cargando reportes");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <div style={{ padding: 20, maxWidth: 560, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
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

      {error && <div style={{ color: colors.dangerText, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      <div style={card}>
        <div style={label}>VENTAS DEL DÍA</div>
        {sales ? (
          <>
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>{money(sales.totalApplied)}</div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 10 }}>{sales.paymentCount} cobros</div>
            {sales.byMethod.map((m) => (
              <div key={m.method} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                <span style={{ textTransform: "capitalize" }}>{m.method}</span>
                <span>{money(m.totalTendered)}</span>
              </div>
            ))}
          </>
        ) : (
          <div style={{ color: colors.textDim, fontSize: 13 }}>Cargando…</div>
        )}
      </div>

      <div style={card}>
        <div style={label}>ESTADO DE CAJA</div>
        {cash && cash.status !== "NO_SESSION" ? (
          <>
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              Estado: <strong style={{ color: colors.success }}>{cash.status}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Base inicial</span>
              <span>{cash.openingCash ? money(cash.openingCash) : "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>Esperado en caja</span>
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
              <div key={c.customerId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
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
              <div key={s.supplierId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
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
  );
}
