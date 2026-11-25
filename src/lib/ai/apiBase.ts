const DEFAULT_ALLOWED_ORIGINS = new Set<string>([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
]);

function parseHttpOrigin(raw?: string | null): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed === "MY_APP_URL") return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "capacitor:") {
      return parsed.host ? `capacitor://${parsed.host}` : null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin && parsed.origin !== "null" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function normalizeApiBaseUrl(raw?: string | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${cleanPath}`;
  } catch {
    return "";
  }
}

export function buildAiApiUrl(path: string, configuredBaseUrl?: string | null): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = normalizeApiBaseUrl(configuredBaseUrl);
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function getAllowedCorsOrigins(appUrlEnv?: string | null, extraOriginsCsv?: string | null): Set<string> {
  const allowed = new Set<string>(DEFAULT_ALLOWED_ORIGINS);
  const appOrigin = parseHttpOrigin(appUrlEnv);
  if (appOrigin) {
    allowed.add(appOrigin);
  }
  if (extraOriginsCsv) {
    for (const part of extraOriginsCsv.split(",")) {
      const origin = parseHttpOrigin(part);
      if (origin) {
        allowed.add(origin);
      }
    }
  }
  return allowed;
}

export function resolveCorsOrigin(
  requestOrigin?: string | null,
  appUrlEnv?: string | null,
  extraOriginsCsv?: string | null,
): string | null {
  const origin = parseHttpOrigin(requestOrigin);
  if (!origin) return null;
  const allowed = getAllowedCorsOrigins(appUrlEnv, extraOriginsCsv);
  return allowed.has(origin) ? origin : null;
}
