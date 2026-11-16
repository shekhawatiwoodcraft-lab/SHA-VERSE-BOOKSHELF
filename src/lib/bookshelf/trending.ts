export interface WeekWindow {
  weekKey: string;
  weekStartIso: string;
  weekEndIso: string;
  msUntilNextWeek: number;
}

export interface TrendableBook {
  id: string;
  created_at?: string | null;
  views_count?: number | null;
  likes_count?: number | null;
  downloads_count?: number | null;
  comments_count?: number | null;
  shares_count?: number | null;
}

export interface WeeklyEventCounts {
  views: number;
  likes: number;
  downloads: number;
  comments: number;
  shares: number;
}

/**
 * Computes the current ISO UTC week window (Monday 00:00:00 UTC -> next Monday 00:00:00 UTC).
 * Because Trending includes `weekKey` in its React Query key and auto-refreshes at week rollover,
 * the Trending tab updates automatically every week.
 */
export function getCurrentWeekWindow(now: Date = new Date()): WeekWindow {
  const utcYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth();
  const utcDate = now.getUTCDate();
  const dayOfWeek = now.getUTCDay(); // 0 (Sun) .. 6 (Sat)
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const weekStart = new Date(Date.UTC(utcYear, utcMonth, utcDate + diffToMonday, 0, 0, 0, 0));
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Compute ISO week number
  const thursday = new Date(weekStart.getTime() + 3 * 24 * 60 * 60 * 1000);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4, 0, 0, 0, 0));
  const jan4Day = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const firstMonday = new Date(jan4.getTime() - (jan4Day - 1) * 24 * 60 * 60 * 1000);
  const weekNum = Math.floor((weekStart.getTime() - firstMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;

  const weekKey = `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
  const msUntilNextWeek = Math.max(1000, weekEnd.getTime() - now.getTime());

  return {
    weekKey,
    weekStartIso: weekStart.toISOString(),
    weekEndIso: weekEnd.toISOString(),
    msUntilNextWeek,
  };
}

/**
 * Sorts Discover books so recently launched books always appear first (created_at DESC).
 */
export function sortDiscoverBooks<T extends { id: string; created_at?: string | null }>(books: T[]): T[] {
  return [...books].sort((a, b) => {
    const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (tB !== tA) return tB - tA;
    return b.id.localeCompare(a.id);
  });
}

/**
 * Computes deterministic Trending score prioritizing current-week engagement (views + likes)
 * and total views + likes so highest views & likes appear first, with weekly auto-rotation.
 */
export function computeTrendingScore(
  book: TrendableBook,
  weeklyEvents?: WeeklyEventCounts | null,
): number {
  const totalViews = Number(book.views_count || 0);
  const totalLikes = Number(book.likes_count || 0);

  if (weeklyEvents) {
    const weeklyScore =
      weeklyEvents.views * 3 +
      weeklyEvents.likes * 5 +
      weeklyEvents.downloads * 2 +
      weeklyEvents.comments * 2 +
      weeklyEvents.shares * 2;
    return weeklyScore * 10 + totalViews + totalLikes * 2;
  }

  return totalViews + totalLikes * 2;
}

export function rankTrendingBooks<T extends TrendableBook>(
  books: T[],
  weeklyEventsByBookId?: Record<string, WeeklyEventCounts>,
): T[] {
  return [...books].sort((a, b) => {
    const scoreA = computeTrendingScore(a, weeklyEventsByBookId?.[a.id]);
    const scoreB = computeTrendingScore(b, weeklyEventsByBookId?.[b.id]);
    if (scoreB !== scoreA) return scoreB - scoreA;

    const viewsDiff = Number(b.views_count || 0) - Number(a.views_count || 0);
    if (viewsDiff !== 0) return viewsDiff;

    const likesDiff = Number(b.likes_count || 0) - Number(a.likes_count || 0);
    if (likesDiff !== 0) return likesDiff;

    const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tB - tA;
  });
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Formats an ISO week window (Monday 00:00Z -> next Monday 00:00Z) as a
 * compact inclusive display range like "Nov 9 – Nov 15".
 */
export function formatWeekRangeLabel(weekStartIso: string, weekEndIso: string): string {
  const start = new Date(weekStartIso);
  const endInclusive = new Date(new Date(weekEndIso).getTime() - 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endInclusive.getTime())) {
    return "This Week";
  }
  const sMonth = MONTH_SHORT[start.getUTCMonth()];
  const sDay = start.getUTCDate();
  const eMonth = MONTH_SHORT[endInclusive.getUTCMonth()];
  const eDay = endInclusive.getUTCDate();
  return `${sMonth} ${sDay} – ${eMonth} ${eDay}`;
}

export type LibraryProgressFilter = "all" | "in_progress" | "finished";

export interface ReadingHistoryEntry {
  id: string;
  current_page?: number | null;
  total_pages?: number | null;
  completed?: boolean | null;
  last_read_at?: string | null;
  book?: {
    id: string;
    title: string;
    author?: string | null;
    category?: string | null;
    pages?: number | null;
    cover_url?: string | null;
    book_url?: string | null;
  } | null;
}

export function computeReadingProgressStats(item: ReadingHistoryEntry): {
  currentPage: number;
  totalPages: number;
  percent: number;
  isFinished: boolean;
} {
  const totalPages = Math.max(1, Number(item.total_pages || item.book?.pages || 100));
  const rawPage = Math.max(0, Number(item.current_page || 0));
  const currentPage = Math.min(Math.max(rawPage, 1), totalPages);
  const percent = item.completed
    ? 100
    : Math.min(100, Math.max(0, Math.round((rawPage / totalPages) * 100)));
  const isFinished = Boolean(item.completed) || percent >= 100;
  return { currentPage, totalPages, percent, isFinished };
}

export function filterReadingHistory<T extends ReadingHistoryEntry>(
  items: T[],
  options: {
    filter?: LibraryProgressFilter;
    search?: string;
    category?: string;
  } = {},
): T[] {
  const { filter = "all", search = "", category = "All" } = options;
  const q = search.trim().toLowerCase();

  return items.filter((item) => {
    if (!item.book) return false;

    if (category && category !== "All" && item.book.category !== category) {
      return false;
    }

    if (q) {
      const title = (item.book.title || "").toLowerCase();
      const author = (item.book.author || "").toLowerCase();
      if (!title.includes(q) && !author.includes(q)) return false;
    }

    const { isFinished } = computeReadingProgressStats(item);
    if (filter === "finished") return isFinished;
    if (filter === "in_progress") return !isFinished;
    return true;
  });
}

