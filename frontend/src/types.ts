export type Role = "servidor" | "cajero" | "supervisor" | "admin";

export interface Session {
  accessToken: string;
  userId: string;
  tenantId: string;
  role: Role;
  email: string;
}
