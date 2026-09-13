import React, { useState } from "react";
import { Session } from "./types";
import LoginScreen from "./screens/LoginScreen";
import ServerScreen from "./screens/ServerScreen";
import CashierScreen from "./screens/CashierScreen";
import AdminScreen from "./screens/AdminScreen";
import { colors } from "./lib/theme";

type View = "servidor" | "cajero" | "admin";

/**
 * Root router. Owns only: auth state, and which screen a given role sees.
 * All business logic lives inside each loop's own screen module —
 * LOOP 06 (ServerScreen), LOOP 07 (CashierScreen) — and the admin panel
 * (reportes/proveedores/créditos/recibos) lives in AdminScreen — not here.
 */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<View>("cajero");

  if (!session) return <LoginScreen onLogin={setSession} />;

  const canSeeServer = session.role === "servidor" || session.role === "admin";
  const canSeeCashier = ["cajero", "supervisor", "admin"].includes(session.role);
  const canSeeAdmin = ["supervisor", "admin"].includes(session.role);

  const options: Array<{ value: View; label: string }> = [];
  if (canSeeCashier) options.push({ value: "cajero", label: "Vista cajero" });
  if (canSeeServer) options.push({ value: "servidor", label: "Vista servidor" });
  if (canSeeAdmin) options.push({ value: "admin", label: "Vista admin" });

  // If the current view isn't allowed for this role, fall back to the
  // first option this user actually has (covers roles like "servidor"
  // that never had cajero access, without a tangle of inline conditions).
  const effectiveView: View =
    (view === "servidor" && canSeeServer) || (view === "cajero" && canSeeCashier) || (view === "admin" && canSeeAdmin)
      ? view
      : options[0]?.value ?? "cajero";

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text, fontFamily: "'Segoe UI', ui-sans-serif, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ fontWeight: 800 }}>FAST TRACK</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: colors.textMuted }}>
          {session.email} · {session.role}
          {options.length > 1 && (
            <select
              value={effectiveView}
              onChange={(e) => setView(e.target.value as View)}
              style={{ background: colors.surface, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 6, padding: "4px 6px" }}
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setSession(null)}
            style={{ background: "none", border: `1px solid ${colors.border}`, color: colors.textMuted, borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}
          >
            Salir
          </button>
        </div>
      </div>
      {effectiveView === "servidor" && <ServerScreen session={session} />}
      {effectiveView === "admin" && <AdminScreen session={session} />}
      {effectiveView === "cajero" && <CashierScreen session={session} />}
    </div>
  );
}
