import React, { useEffect, useState } from "react";
import { Session } from "../../types";
import { apiFetch, genIdempotencyKey, money } from "../../lib/api";
import { colors, btnPrimary, inputStyle, btnGhost } from "../../lib/theme";

interface PendingObligation {
  obligationId: string;
  tableLabel: string;
  dinerName: string | null;
  remaining: string;
}
interface CustomerBalance {
  customerId: string;
  name: string;
  outstandingBalance: string;
}

/**
 * Créditos a clientes (rutas /credits/*). Convierte cuentas pendientes de
 * mesas (mismo reporte que usa el cajero) en crédito, y registra abonos
 * contra clientes con saldo. No hay GET /customers, así que igual que en
 * proveedores, la lista de clientes "conocidos" sale del reporte de saldos.
 */
export default function CreditsScreen({ session }: { session: Session }) {
  const [pending, setPending] = useState<PendingObligation[]>([]);
  const [customers, setCustomers] = useState<CustomerBalance[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customerMode, setCustomerMode] = useState<"existing" | "new">("new");
  const [existingId, setExistingId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newType, setNewType] = useState<"persona" | "empresa">("persona");
  const [creditLimit, setCreditLimit] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const [payingId, setPayingId] = useState<string | null>(null);
  const [payCash, setPayCash] = useState("");
  const [payTransfer, setPayTransfer] = useState("");

  const load = async () => {
    try {
      const [p, c] = await Promise.all([
        apiFetch(session, "/reports/pending-collections"),
        apiFetch(session, "/reports/customer-credits"),
      ]);
      setPending(p.obligations);
      setCustomers(c.customers);
    } catch {
      /* ignore transient errors */
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const selectedTotal = pending.filter((o) => selected.has(o.obligationId)).reduce((s, o) => s + Number(o.remaining), 0);

  const grantCredit = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const customer =
        customerMode === "existing"
          ? { id: existingId.trim() }
          : { name: newName.trim(), phone: newPhone.trim(), type: newType, creditLimit };
      await apiFetch(session, "/credits", {
        method: "POST",
        body: JSON.stringify({ obligationIds: [...selected], customer, idempotencyKey: genIdempotencyKey() }),
      });
      setMsg({ ok: true, text: "Crédito registrado." });
      setSelected(new Set());
      setNewName("");
      setNewPhone("");
      setCreditLimit("");
      setExistingId("");
      await load();
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Error" });
    } finally {
      setLoading(false);
    }
  };

  const registerRepayment = async (customerId: string) => {
    setLoading(true);
    setMsg(null);
    try {
      const tenders = [];
      if (Number(payCash) > 0) tenders.push({ method: "efectivo", amount: payCash });
      if (Number(payTransfer) > 0) tenders.push({ method: "transferencia", amount: payTransfer });
      await apiFetch(session, `/credits/${customerId}/repayments`, {
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
      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>CUENTAS PENDIENTES ({pending.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {pending.map((o) => (
          <button
            key={o.obligationId}
            onClick={() => toggle(o.obligationId)}
            style={{
              textAlign: "left",
              padding: 12,
              borderRadius: 10,
              border: selected.has(o.obligationId) ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
              background: selected.has(o.obligationId) ? "#332A1C" : colors.surface,
              color: colors.text,
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
              <span>
                {o.tableLabel}
                {o.dinerName ? ` · ${o.dinerName}` : ""}
              </span>
              <span>{money(o.remaining)}</span>
            </div>
          </button>
        ))}
        {pending.length === 0 && <div style={{ color: colors.textDim, fontSize: 13 }}>Sin cuentas pendientes.</div>}
      </div>

      {selected.size > 0 && (
        <div style={{ padding: 14, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.surface, marginBottom: 16 }}>
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            Fiar <strong>{money(selectedTotal)}</strong>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button onClick={() => setCustomerMode("new")} style={customerMode === "new" ? btnPrimary : btnGhost}>
              Cliente nuevo
            </button>
            <button onClick={() => setCustomerMode("existing")} style={customerMode === "existing" ? btnPrimary : btnGhost}>
              Ya existe
            </button>
          </div>

          {customerMode === "new" ? (
            <>
              <input placeholder="Nombre" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, marginBottom: 6 }} />
              <input placeholder="Teléfono" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} style={{ ...inputStyle, marginBottom: 6 }} />
              <select value={newType} onChange={(e) => setNewType(e.target.value as "persona" | "empresa")} style={{ ...inputStyle, marginBottom: 6 }}>
                <option value="persona">Persona</option>
                <option value="empresa">Empresa</option>
              </select>
              <input
                placeholder="Límite de crédito"
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value.replace(/[^\d.]/g, ""))}
                style={{ ...inputStyle, marginBottom: 10 }}
              />
            </>
          ) : (
            <select value={existingId} onChange={(e) => setExistingId(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }}>
              <option value="">Selecciona un cliente</option>
              {customers.map((c) => (
                <option key={c.customerId} value={c.customerId}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={grantCredit}
            disabled={loading || (customerMode === "new" ? !newName || !newPhone || !creditLimit : !existingId)}
            style={{ ...btnPrimary, width: "100%" }}
          >
            {loading ? "GUARDANDO…" : "REGISTRAR CRÉDITO"}
          </button>
        </div>
      )}

      {msg && (
        <div style={{ padding: 10, borderRadius: 8, marginBottom: 14, background: msg.ok ? "#1E2A1D" : "#2A1D1A", color: msg.ok ? colors.success : colors.dangerText, fontSize: 13 }}>
          {msg.text}
        </div>
      )}

      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>CLIENTES CON SALDO ({customers.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {customers.map((c) => (
          <div key={c.customerId} style={{ padding: 12, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.surface }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginBottom: 8 }}>
              <span>{c.name}</span>
              <span style={{ color: colors.dangerText }}>{money(c.outstandingBalance)}</span>
            </div>
            {payingId === c.customerId ? (
              <div>
                <input placeholder="Efectivo" value={payCash} onChange={(e) => setPayCash(e.target.value.replace(/[^\d.]/g, ""))} style={{ ...inputStyle, marginBottom: 6 }} />
                <input placeholder="Transferencia" value={payTransfer} onChange={(e) => setPayTransfer(e.target.value.replace(/[^\d.]/g, ""))} style={{ ...inputStyle, marginBottom: 8 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => registerRepayment(c.customerId)} disabled={loading} style={{ ...btnPrimary, flex: 1 }}>
                    Confirmar abono
                  </button>
                  <button onClick={() => setPayingId(null)} style={btnGhost}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setPayingId(c.customerId)} style={{ ...btnGhost, width: "100%" }}>
                Abonar
              </button>
            )}
          </div>
        ))}
        {customers.length === 0 && <div style={{ color: colors.textDim, fontSize: 13 }}>Sin clientes con saldo.</div>}
      </div>
    </div>
  );
}
