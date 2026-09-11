import React, { useState } from "react";
import { Session } from "../types";
import { loginWithPassword, fetchMe } from "../lib/api";
import { colors, btnPrimary, inputStyle } from "../lib/theme";

export default function LoginScreen({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      const accessToken = await loginWithPassword(email, password);
      const me = await fetchMe(accessToken);
      onLogin({
        accessToken,
        userId: me.userId,
        tenantId: me.tenantId,
        role: me.role as Session["role"],
        email,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Segoe UI', ui-sans-serif, sans-serif",
      }}
    >
      <div style={{ width: "min(340px, 90vw)", padding: 24, background: colors.surface, borderRadius: 14, border: `1px solid ${colors.border}` }}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>FAST TRACK</div>
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 20 }}>Inicia sesión para continuar</div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo" style={{ ...inputStyle, marginBottom: 8 }} />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="contraseña"
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          style={{ ...inputStyle, marginBottom: 12 }}
        />
        {error && <div style={{ color: colors.dangerText, fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <button onClick={handleSubmit} disabled={loading || !email || !password} style={{ ...btnPrimary, width: "100%", opacity: loading ? 0.6 : 1 }}>
          {loading ? "ENTRANDO…" : "ENTRAR"}
        </button>
      </div>
    </div>
  );
}
