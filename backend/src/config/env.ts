import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. Copy .env.example to .env and fill it in.`
    );
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  databaseUrl: required("DATABASE_URL"),
  // Comma-separated list of allowed browser origins for CORS, e.g.
  // "https://pa-comer-frontend.vercel.app,https://otro-dominio.com".
  // Defaults to "*" (any origin) since this API is only ever called with a
  // Bearer token, never cookies — a wildcard here carries none of the
  // credential-leak risk it would with cookie-based auth. Tighten this once
  // the frontend's real production domain is final.
  allowedOrigins: process.env.ALLOWED_ORIGINS ?? "*",
};
