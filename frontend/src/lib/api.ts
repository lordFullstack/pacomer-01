import { Session } from "../types";

/**
 * Configured via Vite env vars (see .env.example); falls back to the
 * current live restaurant's values so `npm run dev` works out of the box
 * without a .env file. Production deploys should set real env vars.
 */
export const API_BASE = import.meta.env.VITE_API_BASE || "https://pacomer-01.onrender.com";
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://lfxflopwcxrgnsagqejj.supabase.co";
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxmeGZsb3B3Y3hyZ25zYWdxZWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MjIwMjUsImV4cCI6MjEwNDA5ODAyNX0.-j1-Y4A46wlj_ydYKVWkWkdOwFmpX9dAkIqDduq2YKE";

export class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * The one function every screen uses to call the backend. Centralizing this
 * (instead of each screen doing its own fetch) means the Authorization
 * header, error shape, and base URL only need to be right in one place.
 */
export async function apiFetch(session: Session, path: string, options: RequestInit = {}) {
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
    throw new ApiError(body.message || `HTTP ${res.status}`, res.status, body.error);
  }
  return body;
}

/** Real Supabase Auth password login — no mock, this is the live auth flow. */
export async function loginWithPassword(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description || body.msg || "Login failed");
  return body.access_token as string;
}

/** Fetches /me to resolve which tenant/role the just-authenticated user has. */
export async function fetchMe(accessToken: string): Promise<{ userId: string; tenantId: string; role: string }> {
  const res = await fetch(`${API_BASE}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("No se pudo verificar el usuario en el backend");
  return res.json();
}

export function genIdempotencyKey(): string {
  return `ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const money = (n: number | string) =>
  Number(n).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
