export const LEGACY_DISCONNECTED_PROJECT_REF = "plmhjuqedtkiffzhberf";

export const DEFAULT_SUPABASE_URL = "https://gkmyhgebjqkdvjzgbrhr.supabase.co";
export const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rgJcImQqgXg8NJMKRqvFyg_y7g1jXfE";

/**
 * Normalizes a Supabase project URL by stripping trailing slashes or accidental
 * `/rest/v1` / `/auth/v1` suffixes, and rejecting the disconnected legacy project.
 */
export function normalizeSupabaseUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) return "";

  const withoutApiSuffix = trimmed
    .replace(/\/+(?:rest|auth|storage|realtime)\/v1\/?$/i, "")
    .replace(/\/+$/, "");

  if (withoutApiSuffix.toLowerCase().includes(LEGACY_DISCONNECTED_PROJECT_REF)) {
    return "";
  }

  return withoutApiSuffix;
}

export function resolveSupabaseConfig(env?: {
  url?: string | null;
  key?: string | null;
}): { url: string; publishableKey: string; projectRef: string } {
  const normalizedEnvUrl = normalizeSupabaseUrl(env?.url);
  const url = normalizedEnvUrl || DEFAULT_SUPABASE_URL;

  const envKey = (env?.key || "").trim();
  const isLegacyEnv = Boolean((env?.url || "").toLowerCase().includes(LEGACY_DISCONNECTED_PROJECT_REF));
  const publishableKey = !isLegacyEnv && envKey ? envKey : DEFAULT_SUPABASE_PUBLISHABLE_KEY;

  const refMatch = /^https?:\/\/([a-z0-9-]+)\.supabase\.co/i.exec(url);
  const projectRef = refMatch?.[1] || "";

  return { url, publishableKey, projectRef };
}

export const SCHEMA_SETUP_HINT =
  "Database tables are not created yet in Supabase. Run supabase/setup_new_project.sql in Supabase Dashboard → SQL Editor.";

/**
 * Detects PostgREST PGRST205 ("Could not find the table ... in the schema cache")
 * and PostgreSQL 42P01 ("relation ... does not exist") errors on uninitialized DBs.
 */
export function isSchemaMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: unknown; message?: unknown; status?: unknown };
  const code = typeof err.code === "string" ? err.code.toUpperCase() : "";
  if (code === "PGRST205" || code === "PGRST202" || code === "42P01") {
    return true;
  }
  const msg = typeof err.message === "string" ? err.message : "";
  return /could not find the (?:table|function).*in the schema cache|relation .* does not exist/i.test(msg);
}

/**
 * React Query retry policy: never retry 4xx / schema-missing errors, retry transient errors up to 2 times.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isSchemaMissingError(error)) return false;
  if (error && typeof error === "object") {
    const status = Number((error as { status?: unknown }).status || 0);
    if (status >= 400 && status < 500) return false;
  }
  return failureCount < 2;
}
