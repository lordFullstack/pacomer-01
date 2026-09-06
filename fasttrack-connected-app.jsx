import React, { useState, useEffect, useCallback, useRef } from "react";

/**
 * FAST TRACK — Connected App
 *
 * This is the first version of the UI that talks to the REAL backend
 * (Render) and REAL Supabase Auth — no more mocks. Configure the two
 * constants below once; everyone using this artifact points at the same
 * live restaurant.
 */
const API_BASE = "https://pa-comer-3-0.onrender.com";
const SUPABASE_URL = "https://lfxflopwcxrgnsagqejj.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxmeGZsb3B3Y3hyZ25zYWdxZWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MjIwMjUsImV4cCI6MjEwNDA5ODAyNX0.-j1-Y4A46wlj_ydYKVWkWkdOwFmpX9dAkIqDduq2YKE";

type Role = "servidor" | "cajero" | "supervisor" | "admin";

interface Session {
  accessToken: string;
  userId: string;
  tenantId: string;
  role: Role;
  email: string;
}

const money = (n: number | string) =>
  Number(n).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

function genIdempotencyKey(): string {
  return `ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// API client — every call goes to the real Render backend.
// ---------------------------------------------------------------------------
async function apiFetch(session: Session, path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...(options.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `HTTP ${res.status}`);
    (err as any).code = body.error;
    (err as any).status = res.status;
    throw err;
  }
  return body;
}

async function loginWithPassword(email: string, password: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description || body.msg || "Login failed");
  return body.access_token as string;
}

// ---------------------------------------------------------------------------
// Login screen
// ---------------------------------------------------------------------------
function LoginScreen({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      const accessToken = await loginWithPassword(email, password);
      const meRes = await fetch(`${API_BASE}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!meRes.ok) throw new Error("No se pudo verificar el usuario en el backend");
      const me = await meRes.json();
      onLogin({ accessToken, userId: me.userId, tenantId: me.tenantId, role: me.role, email });
    } catch (e: any) {
      setError(e.message || "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#1C1A17", color: "#F5F1EA", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', ui-sans-serif, sans-serif" }}>
      <div style={{ width: "min(340px, 90vw)", padding: 24, background: "#26221D", borderRadius: 14, border: "1px solid #33302A" }}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>FAST TRACK</div>
        <div style={{ fontSize: 12, color: "#9C948A", marginBottom: 20 }}>Inicia sesión para continuar</div>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="correo"
          style={{ width: "100%", boxSizing: "border-box", background: "#1C1A17", border: "1px solid #33302A", borderRadius: 8, color: "#F5F1EA", padding: "10px 12px", fontSize: 14, marginBottom: 8 }}
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="contraseña"
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          style={{ width: "100%", boxSizing: "border-box", background: "#1C1A17", border: "1px solid #33302A", borderRadius: 8, color: "#F5F1EA", padding: "10px 12px", fontSize: 14, marginBottom: 12 }}
        />
        {error && <div style={{ color: "#D98A6E", fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <button
          onClick={handleSubmit}
          disabled={loading || !email || !password}
          style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: "#E8A33D", color: "#1C1A17", fontWeight: 800, fontSize: 14, cursor: "pointer", opacity: loading ? 0.6 : 1 }}
        >
          {loading ? "ENTRANDO…" : "ENTRAR"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Server screen — POST /service-line/diners (real)
// ---------------------------------------------------------------------------
function ServerScreen({ session }: { session: Session }) {
  const [amount, setAmount] = useState("");
  const [tableLabel, setTableLabel] = useState("");
  const [paymentMode, setPaymentMode] = useState<"individual" | "conjunto">("individual");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [tables, setTables] = useState<Array<{ id: string; label: string }>>([]);
  const currentKeyRef = useRef<string | null>(null);

  useEffect(() => {
    apiFetch(session, "/reports/pending-collections")
      .then((r) => {
        const seen = new Map<string, string>();
        r.obligations.forEach((o: any) => seen.set(o.tableId, o.tableLabel));
        setTables(Array.from(seen, ([id, label]) => ({ id, label })));
      })
      .catch(() => {});
  }, [session]);

  const submit = async () => {
    if (!tableLabel || !amount) return;
    if (!currentKeyRef.current) currentKeyRef.current = genIdempotencyKey();
    setSubmitting(true);
    try {
      const out = await apiFetch(session, "/service-line/diners", {
        method: "POST",
        body: JSON.stringify({
          tableId: tableLabel,
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
    } catch (e: any) {
      setFeedback({ ok: false, text: e.message || "Error" });
    } finally {
      setSubmitting(false);
      setTimeout(() => setFeedback(null), 2500);
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 420, margin: "0 auto" }}>
      <div style={{ fontSize: 12, color: "#9C948A", marginBottom: 8 }}>MESA (UUID por ahora — sin selector visual todavía)</div>
      <select
        value={tableLabel}
        onChange={(e) => setTableLabel(e.target.value)}
        style={{ width: "100%", padding: 10, borderRadius: 8, background: "#26221D", color: "#F5F1EA", border: "1px solid #33302A", marginBottom: 14 }}
      >
        <option value="">— elige mesa —</option>
        {tables.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {(["individual", "conjunto"] as const).map((m) => (
          <button key={m} onClick={() => setPaymentMode(m)} style={{ flex: 1, padding: 10, borderRadius: 8, border: paymentMode === m ? "2px solid #7A8B78" : "1px solid #33302A", background: paymentMode === m ? "#7A8B78" : "#26221D", color: paymentMode === m ? "#1C1A17" : "#F5F1EA", fontWeight: 700, textTransform: "capitalize" }}>{m}</button>
        ))}
      </div>

      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (opcional)" style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, background: "#26221D", color: "#F5F1EA", border: "1px solid #33302A", marginBottom: 14 }} />
      <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Valor" style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, background: "#26221D", color: "#F5F1EA", border: "1px solid #33302A", marginBottom: 14, fontSize: 20, fontWeight: 800 }} />

      <button onClick={submit} disabled={submitting || !tableLabel || !amount} style={{ width: "100%", padding: 14, borderRadius: 10, border: "none", background: "#E8A33D", color: "#1C1A17", fontWeight: 800, cursor: "pointer", opacity: submitting ? 0.6 : 1 }}>
        {submitting ? "REGISTRANDO…" : "REGISTRAR"}
      </button>

      {feedback && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: feedback.ok ? "#1E2A1D" : "#2A1D1A", color: feedback.ok ? "#8FBF8A" : "#D98A6E", fontSize: 13 }}>
          {feedback.text}
        </div>
      )}
      <div style={{ marginTop: 16, fontSize: 11, color: "#5A554C" }}>
        Nota: todavía no hay endpoint para listar/crear mesas por nombre — el selector se llena solo con mesas que ya tienen algo pendiente. Para una mesa nueva, necesitas su UUID real (creado por SQL por ahora).
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cashier screen — GET /reports/pending-collections + POST /payments (real)
// ---------------------------------------------------------------------------
function CashierScreen({ session }: { session: Session }) {
  const [pending, setPending] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cashStatus, setCashStatus] = useState<any>(null);
  const [openingCash, setOpeningCash] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cashInput, setCashInput] = useState("");
  const [transferInput, setTransferInput] = useState("");
  const [ticket, setTicket] = useState<{ text: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [pend, cash] = await Promise.all([
        apiFetch(session, "/reports/pending-collections"),
        apiFetch(session, "/reports/cash-status"),
      ]);
      setPending(pend.obligations);
      setCashStatus(cash);
    } catch {
      /* transient errors during polling are fine to ignore */
    }
  }, [session]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000); // simple polling until real Realtime is wired
    return () => clearInterval(t);
  }, [refresh]);

  const selectedObligations = pending.filter((o) => selected.has(o.obligationId));
  const selectedRemaining = selectedObligations.reduce((s, o) => s + Number(o.remaining), 0);
  const cashCents = Number(cashInput || 0);
  const transferCents = Number(transferInput || 0);
  const change = Math.max(0, cashCents + transferCents - selectedRemaining);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openCashSession = async () => {
    setLoading(true);
    try {
      await apiFetch(session, "/cash-sessions", { method: "POST", body: JSON.stringify({ openingCash: openingCash || "0.00" }) });
      await refresh();
    } catch (e: any) {
      setTicket({ ok: false, text: e.message });
    } finally {
      setLoading(false);
    }
  };

  const confirmPayment = async () => {
    setLoading(true);
    try {
      const tenders = [];
      if (cashCents > 0) tenders.push({ method: "efectivo", amount: cashInput });
      if (transferCents > 0) tenders.push({ method: "transferencia", amount: transferInput });
      const out = await apiFetch(session, "/payments", {
        method: "POST",
        body: JSON.stringify({ obligationIds: [...selected], tenders, idempotencyKey: genIdempotencyKey() }),
      });
      setTicket({ ok: true, text: `Cobrado ${money(out.appliedAmount)}${Number(out.changeAmount) > 0 ? ` · cambio ${money(out.changeAmount)}` : ""}` });
      setSelected(new Set());
      setDrawerOpen(false);
      setCashInput("");
      setTransferInput("");
      await refresh();
    } catch (e: any) {
      setTicket({ ok: false, text: e.message });
    } finally {
      setLoading(false);
      setTimeout(() => setTicket(null), 2500);
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 480, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, fontSize: 13 }}>
        <div>
          Caja:{" "}
          <strong style={{ color: cashStatus?.status && cashStatus.status !== "NO_SESSION" ? "#8FBF8A" : "#D98A6E" }}>
            {cashStatus?.status && cashStatus.status !== "NO_SESSION" ? cashStatus.status : "SIN ABRIR"}
          </strong>
          {cashStatus?.expectedCash && <span style={{ color: "#9C948A", marginLeft: 8 }}>esperado {money(cashStatus.expectedCash)}</span>}
        </div>
      </div>

      {(!cashStatus || cashStatus.status === "NO_SESSION") && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, border: "1px solid #33302A", background: "#26221D" }}>
          <div style={{ fontSize: 12, color: "#9C948A", marginBottom: 6 }}>Abrir caja con base inicial</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={openingCash} onChange={(e) => setOpeningCash(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" style={{ flex: 1, padding: 8, borderRadius: 6, background: "#1C1A17", border: "1px solid #33302A", color: "#F5F1EA" }} />
            <button onClick={openCashSession} disabled={loading} style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#E8A33D", color: "#1C1A17", fontWeight: 700 }}>Abrir</button>
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: "#9C948A", marginBottom: 8 }}>PENDIENTES ({pending.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {pending.map((o) => (
          <button key={o.obligationId} onClick={() => toggle(o.obligationId)} style={{ textAlign: "left", padding: 12, borderRadius: 10, border: selected.has(o.obligationId) ? "2px solid #E8A33D" : "1px solid #33302A", background: selected.has(o.obligationId) ? "#332A1C" : "#26221D", color: "#F5F1EA", cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
              <span>{o.tableLabel}{o.dinerName ? ` · ${o.dinerName}` : ""}</span>
              <span>{money(o.remaining)}</span>
            </div>
          </button>
        ))}
        {pending.length === 0 && <div style={{ color: "#5A554C", fontSize: 13 }}>Sin pendientes.</div>}
      </div>

      {selected.size > 0 && (
        <button onClick={() => { setCashInput(selectedRemaining.toString()); setDrawerOpen(true); }} style={{ width: "100%", padding: 14, borderRadius: 10, border: "none", background: "#E8A33D", color: "#1C1A17", fontWeight: 800, marginBottom: 14 }}>
          COBRAR · {money(selectedRemaining)}
        </button>
      )}

      {drawerOpen && (
        <div style={{ padding: 16, borderRadius: 12, border: "1px solid #33302A", background: "#26221D", marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#9C948A", marginBottom: 4 }}>EFECTIVO</div>
          <input value={cashInput} onChange={(e) => setCashInput(e.target.value.replace(/[^\d.]/g, ""))} style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, background: "#1C1A17", border: "1px solid #33302A", color: "#F5F1EA", marginBottom: 10, fontWeight: 800, fontSize: 18 }} />
          <div style={{ fontSize: 12, color: "#9C948A", marginBottom: 4 }}>TRANSFERENCIA</div>
          <input value={transferInput} onChange={(e) => setTransferInput(e.target.value.replace(/[^\d.]/g, ""))} style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, background: "#1C1A17", border: "1px solid #33302A", color: "#F5F1EA", marginBottom: 10, fontWeight: 800, fontSize: 18 }} />
          <div style={{ fontSize: 13, color: "#8FBF8A", marginBottom: 10 }}>Cambio: {money(change)}</div>
          <button onClick={confirmPayment} disabled={loading} style={{ width: "100%", padding: 12, borderRadius: 8, border: "none", background: "#E8A33D", color: "#1C1A17", fontWeight: 800 }}>
            {loading ? "PROCESANDO…" : "CONFIRMAR"}
          </button>
        </div>
      )}

      {ticket && (
        <div style={{ padding: 10, borderRadius: 8, background: ticket.ok ? "#1E2A1D" : "#2A1D1A", color: ticket.ok ? "#8FBF8A" : "#D98A6E", fontSize: 13 }}>{ticket.text}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<"servidor" | "cajero">("cajero");

  if (!session) return <LoginScreen onLogin={setSession} />;

  const canSeeServer = session.role === "servidor" || session.role === "admin";
  const canSeeCashier = ["cajero", "supervisor", "admin"].includes(session.role);

  return (
    <div style={{ minHeight: "100vh", background: "#1C1A17", color: "#F5F1EA", fontFamily: "'Segoe UI', ui-sans-serif, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid #33302A" }}>
        <div style={{ fontWeight: 800 }}>FAST TRACK</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#9C948A" }}>
          {session.email} · {session.role}
          {canSeeServer && canSeeCashier && (
            <select value={view} onChange={(e) => setView(e.target.value as any)} style={{ background: "#26221D", color: "#F5F1EA", border: "1px solid #33302A", borderRadius: 6, padding: "4px 6px" }}>
              <option value="cajero">Vista cajero</option>
              <option value="servidor">Vista servidor</option>
            </select>
          )}
          <button onClick={() => setSession(null)} style={{ background: "none", border: "1px solid #33302A", color: "#9C948A", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}>Salir</button>
        </div>
      </div>
      {view === "servidor" && canSeeServer ? <ServerScreen session={session} /> : <CashierScreen session={session} />}
    </div>
  );
}
