import React, { useState } from "react";
import { Session } from "./types";
import LoginScreen from "./screens/LoginScreen";
import ServerScreen from "./screens/ServerScreen";
import CashierScreen from "./screens/CashierScreen";
import { colors } from "./lib/theme";

/**
 * Root router. Owns only: auth state, and which screen a given role sees.
 * All business logic lives inside each loop's own screen module —
 * LOOP 06 (ServerScreen) and LOOP 07 (CashierScreen) — not here.
 */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<"servidor" | "cajero">("cajero");

  if (!session) return <LoginScreen onLogin={setSession} />;

  const canSeeServer = session.role === "servidor" || session.role === "admin";
  const canSeeCashier = ["cajero", "supervisor", "admin"].includes(session.role);

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text, fontFamily: "'Segoe UI', ui-sans-serif, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ fontWeight: 800 }}>FAST TRACK</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: colors.textMuted }}>
          {session.email} · {session.role}
          {canSeeServer && canSeeCashier && (
            <select
              value={view}
              onChange={(e) => setView(e.target.value as "servidor" | "cajero")}
              style={{ background: colors.surface, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 6, padding: "4px 6px" }}
            >
              <option value="cajero">Vista cajero</option>
              <option value="servidor">Vista servidor</option>
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
      {view === "servidor" && canSeeServer ? <ServerScreen session={session} /> : <CashierScreen session={session} />}
    </div>
  );
}
