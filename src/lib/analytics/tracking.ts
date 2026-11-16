import { supabase } from "@/integrations/supabase/client";

const VIEW_DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30-minute session view deduplication window
const SESSION_ID_STORAGE_KEY = "shaverse:analytics_session_id:v1";
const inFlightViews = new Set<string>();
const memoryViewedTimestamps = new Map<string, number>();

export function getAnalyticsSessionId(): string {
  if (typeof window === "undefined") return "ssr-session";
  try {
    let existing = window.sessionStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (!existing) {
      existing =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      window.sessionStorage.setItem(SESSION_ID_STORAGE_KEY, existing);
    }
    return existing;
  } catch {
    return "fallback-session";
  }
}

export function shouldRecordSessionView(
  bookId: string,
  nowMs: number = Date.now(),
  storage?: Pick<Storage, "getItem" | "setItem"> | null,
): boolean {
  if (!bookId) return false;
  if (inFlightViews.has(bookId)) return false;

  const memTs = memoryViewedTimestamps.get(bookId);
  if (memTs && nowMs - memTs < VIEW_DEDUP_WINDOW_MS) {
    return false;
  }

  const targetStorage =
    storage !== undefined
      ? storage
      : typeof window !== "undefined"
        ? window.sessionStorage
        : null;

  if (targetStorage) {
    try {
      const raw = targetStorage.getItem(`book_viewed_at_${bookId}`);
      if (raw) {
        const parsed = Number(raw);
        if (!Number.isNaN(parsed) && nowMs - parsed < VIEW_DEDUP_WINDOW_MS) {
          memoryViewedTimestamps.set(bookId, parsed);
          return false;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return true;
}

export function markSessionViewRecorded(
  bookId: string,
  nowMs: number = Date.now(),
  storage?: Pick<Storage, "getItem" | "setItem"> | null,
): void {
  memoryViewedTimestamps.set(bookId, nowMs);
  const targetStorage =
    storage !== undefined
      ? storage
      : typeof window !== "undefined"
        ? window.sessionStorage
        : null;

  if (targetStorage) {
    try {
      targetStorage.setItem(`book_viewed_at_${bookId}`, String(nowMs));
      targetStorage.setItem(`book_viewed_${bookId}`, "1");
    } catch {
      /* ignore */
    }
  }
}

export function resetViewTrackingMemoryForTests(): void {
  inFlightViews.clear();
  memoryViewedTimestamps.clear();
}

export function createIdempotencyKey(prefix: string, entityId: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${entityId}:${rand}`;
}

function isMissingRpcError(error: any): boolean {
  const code = String(error?.code || "");
  const msg = String(error?.message || "");
  return (
    code === "PGRST202" ||
    code === "42883" ||
    /Could not find the function/i.test(msg) ||
    /does not exist/i.test(msg)
  );
}

/**
 * Records a genuine book view with session deduplication & atomic database RPC.
 * Repeated React renders or rapid BookCard -> BookDetail -> BookReader transitions are deduplicated.
 */
export async function recordBookView(bookId: string): Promise<boolean> {
  if (!bookId || !shouldRecordSessionView(bookId)) return false;

  inFlightViews.add(bookId);
  try {
    const sessionKey = getAnalyticsSessionId();
    const { error } = await (supabase as any).rpc("record_book_view_v2", {
      p_book_id: bookId,
      p_session_key: sessionKey,
    });

    if (error && isMissingRpcError(error)) {
      const legacy = await (supabase as any).rpc("increment_book_views", {
        book_id: bookId,
      });
      if (legacy.error) return false;
      markSessionViewRecorded(bookId);
      return true;
    }

    if (error) return false;
    markSessionViewRecorded(bookId);
    return true;
  } catch {
    return false;
  } finally {
    inFlightViews.delete(bookId);
  }
}

/**
 * Records a verified successful download using an idempotency key so duplicate retries
 * or failed download attempts never corrupt counters.
 */
export async function recordBookDownload(bookId: string, idempotencyKey: string): Promise<boolean> {
  if (!bookId || !idempotencyKey) return false;
  try {
    const { error } = await (supabase as any).rpc("record_book_download", {
      p_book_id: bookId,
      p_idempotency_key: idempotencyKey,
    });
    if (error && isMissingRpcError(error)) {
      const legacy = await (supabase as any).rpc("increment_book_downloads", {
        book_id: bookId,
      });
      return !legacy.error;
    }
    return !error;
  } catch {
    return false;
  }
}

/**
 * Records a genuine share action only after copy/native/external share succeeds.
 */
export async function recordBookShare(
  bookId: string,
  platform: string,
  idempotencyKey: string = createIdempotencyKey(`share_${platform}`, bookId),
): Promise<boolean> {
  if (!bookId) return false;
  try {
    const { error } = await (supabase as any).rpc("record_book_share", {
      p_book_id: bookId,
      p_platform: platform,
      p_idempotency_key: idempotencyKey,
    });
    if (error && isMissingRpcError(error)) {
      return false;
    }
    return !error;
  } catch {
    return false;
  }
}

/**
 * Records active reading duration & pages read without interrupting reading progress.
 */
export async function recordReadingSessionHeartbeat(params: {
  bookId: string;
  deltaSeconds: number;
  pagesRead?: number;
  sessionKey?: string;
}): Promise<boolean> {
  const { bookId, deltaSeconds, pagesRead = 0, sessionKey = getAnalyticsSessionId() } = params;
  if (!bookId || deltaSeconds <= 0) return false;
  try {
    const { error } = await (supabase as any).rpc("record_reading_session_heartbeat", {
      p_book_id: bookId,
      p_session_key: sessionKey,
      p_delta_seconds: Math.round(deltaSeconds),
      p_pages_read: Math.max(0, Math.round(pagesRead)),
    });
    if (error && isMissingRpcError(error)) {
      return false;
    }
    return !error;
  } catch {
    return false;
  }
}
