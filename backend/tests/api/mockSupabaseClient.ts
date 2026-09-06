import { vi } from "vitest";

/**
 * middleware/auth.ts calls supabase.auth.getUser(token) then
 * supabase.from("app_users").select(...).eq(...).single(). We mock the
 * whole config/supabaseClient module so API tests exercise the REAL
 * authenticate() and requireRole() middleware logic — just against a fake
 * client instead of a network call to Supabase.
 *
 * Usage in a test file:
 *   vi.mock("../../src/config/supabaseClient", () => import("./mockSupabaseClient"));
 *   import { setMockUser, clearMockUser } from "./mockSupabaseClient";
 */

interface MockUser {
  authUserId: string;
  tenantId: string;
  role: "servidor" | "cajero" | "supervisor" | "admin";
}

let currentUser: MockUser | null = null;

export function setMockUser(user: MockUser): void {
  currentUser = user;
}

export function clearMockUser(): void {
  currentUser = null;
}

export const supabase = {
  auth: {
    getUser: vi.fn(async (_token: string) => {
      if (!currentUser) {
        return { data: { user: null }, error: { message: "invalid token" } };
      }
      return { data: { user: { id: currentUser.authUserId } }, error: null };
    }),
  },
  from: vi.fn((_table: string) => ({
    select: (_cols: string) => ({
      eq: (_col: string, _val: string) => ({
        single: async () => {
          if (!currentUser) return { data: null, error: { message: "not found" } };
          return { data: { tenant_id: currentUser.tenantId, role: currentUser.role }, error: null };
        },
      }),
    }),
  })),
};
