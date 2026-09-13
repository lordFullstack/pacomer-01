import type { CSSProperties } from "react";

export const colors = {
  bg: "#1C1A17",
  surface: "#26221D",
  border: "#33302A",
  text: "#F5F1EA",
  textMuted: "#9C948A",
  textDim: "#5A554C",
  accent: "#E8A33D",
  secondary: "#7A8B78",
  success: "#8FBF8A",
  danger: "#B3452F",
  dangerText: "#D98A6E",
};

export const btnPrimary: CSSProperties = {
  background: colors.accent,
  color: colors.bg,
  border: "none",
  borderRadius: 10,
  padding: "12px 0",
  fontWeight: 800,
  fontSize: 14,
  cursor: "pointer",
};

export const btnGhost: CSSProperties = {
  background: "transparent",
  color: colors.textMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: "6px 10px",
  fontSize: 12,
  cursor: "pointer",
};

export const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  color: colors.text,
  padding: "10px 12px",
  fontSize: 14,
};
