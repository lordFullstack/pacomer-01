import React, { useState } from "react";
import { Session } from "../types";
import { colors } from "../lib/theme";
import ReportsScreen from "./admin/ReportsScreen";
import ClientsScreen from "./admin/ClientsScreen";
import ProvidersScreen from "./admin/ProvidersScreen";
import CreditsScreen from "./admin/CreditsScreen";
import ReceiptsScreen from "./admin/ReceiptsScreen";

type Tab = "reportes" | "clientes" | "proveedores" | "creditos" | "recibos";

const allTabs: Array<{ key: Tab; label: string }> = [
  { key: "reportes", label: "Reportes" },
  { key: "clientes", label: "Clientes" },
  { key: "proveedores", label: "Proveedores" },
  { key: "creditos", label: "Créditos" },
  { key: "recibos", label: "Recibos" },
];

/**
 * Panel administrativo — agrupa las secciones que no forman parte del
 * flujo diario de servidor/cajero: reportes, clientes, proveedores,
 * créditos y recibos. Un cajero solo ve "Reportes" (ahí vive el log de
 * anulaciones, que ahora es la única forma de anular un cobro); el resto
 * de pestañas sigue siendo exclusivo de supervisor/admin.
 */
export default function AdminScreen({ session }: { session: Session }) {
  const [tab, setTab] = useState<Tab>("reportes");
  const tabs = session.role === "cajero" ? allTabs.filter((t) => t.key === "reportes") : allTabs;

  return (
    <div>
      <div style={{ display: "flex", gap: 4, padding: "10px 20px 0", borderBottom: `1px solid ${colors.border}` }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: "none",
              border: "none",
              borderBottom: tab === t.key ? `2px solid ${colors.accent}` : "2px solid transparent",
              color: tab === t.key ? colors.text : colors.textMuted,
              fontWeight: tab === t.key ? 700 : 400,
              padding: "8px 12px",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "reportes" && <ReportsScreen session={session} />}
      {tab === "clientes" && <ClientsScreen session={session} />}
      {tab === "proveedores" && <ProvidersScreen session={session} />}
      {tab === "creditos" && <CreditsScreen session={session} />}
      {tab === "recibos" && <ReceiptsScreen session={session} />}
    </div>
  );
}
