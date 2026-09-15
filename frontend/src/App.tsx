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
 * LOOP 06 (ServerScreen), LOOP 07 (CashierScreen) and AdminScreen — not here.
 */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<View>("cajero");

  if (!session) return <LoginScreen onLogin={setSession} />;

  const canSeeServer = session.role === "servidor" || session.role === "admin";
  const canSeeCashier = ["cajero", "supervisor", "admin"].includes(session.role);
  // cajero also needs Reportes → Logs de anulaciones (AdminScreen restricts
  // which of its own tabs a cajero sees; only supervisor/admin get the rest).
  const canSeeAdmin = ["cajero", "supervisor", "admin"].includes(session.role);
  const availableViews = [
    canSeeCashier && ("cajero" as const),
    canSeeServer && ("servidor" as const),
    canSeeAdmin && ("admin" as const),
  ].filter(Boolean) as View[];

  const effectiveView = availableViews.includes(view) ? view : availableViews[0];

  const screens: Record<View, React.ReactNode> = {
    servidor: <ServerScreen session={session} />,
    cajero: <CashierScreen session={session} />,
    admin: <AdminScreen session={session} />,
  };
  const viewLabels: Record<View, string> = {
    cajero: "Vista cajero",
    servidor: "Vista servidor",
    admin: "Panel admin",
  };

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: colors.bg, color: colors.text, fontFamily: "'Segoe UI', ui-sans-serif, sans-serif" }}>
      <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ fontWeight: 800 }}>FAST TRACK</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: colors.textMuted }}>
          {session.email} · {session.role}
          {availableViews.length > 1 && (
            <select
              value={effectiveView}
              onChange={(e) => setView(e.target.value as View)}
              style={{ background: colors.surface, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 6, padding: "4px 6px" }}
            >
              {availableViews.map((v) => (
                <option key={v} value={v}>
                  {viewLabels[v]}
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
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{screens[effectiveView]}</div>
    </div>
  );
}