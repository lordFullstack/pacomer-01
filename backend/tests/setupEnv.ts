// Unit tests never touch Supabase or Postgres, but src/config/env.ts fails
// fast if these are missing (by design — see that file's comment). Provide
// harmless placeholders so importing any service module doesn't crash a
// pure-logic test run.
//
// Integration tests are opt-in via TEST_DATABASE_URL (kept distinct from
// DATABASE_URL so a stray/unset DATABASE_URL never silently makes
// integration tests think they have a real database — see testHelpers.ts).
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  process.env.DATABASE_URL ??= "postgresql://placeholder:placeholder@localhost:5432/placeholder";
}
process.env.SUPABASE_URL ??= "https://placeholder.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder-service-role-key";
