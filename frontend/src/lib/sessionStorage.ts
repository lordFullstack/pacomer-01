import { Session } from "../types";

const KEY = "fasttrack.session";

/**
 * localStorage puede fallar (modo privado, storage lleno, SSR-like edge
 * cases); nunca debe tumbar el login por eso.
 */
export function loadStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.accessToken === "string" &&
      typeof parsed.userId === "string" &&
      typeof parsed.tenantId === "string" &&
      typeof parsed.role === "string" &&
      typeof parsed.email === "string"
    ) {
      return parsed as Session;
    }
    return null;
  } catch {
    return null;
  }
}

export function storeSession(session: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Continúa solo en memoria si el storage no está disponible.
  }
}

export function clearStoredSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // no-op
  }
}
