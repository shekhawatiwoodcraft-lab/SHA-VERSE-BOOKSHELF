import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BOOK_PUBLIC_COLUMNS } from "@/lib/constants/bookshelf";
import {
  buildAnalyticsTimeSeries,
  buildBookAnalyticsList,
  computePeriodDelta,
  resolveDateRange,
  resolvePreviousDateRange,
} from "@/lib/analytics/aggregation";
import type {
  AnalyticsEventRecord,
  AnalyticsTimeRangePreset,
  AnalyticsTimeSeriesPoint,
  BookAnalyticsMetrics,
  PeriodDeltaMetric,
  RawBookAnalyticsRecord,
} from "@/lib/analytics/types";

const EXTENDED_BOOK_COLUMNS =
  `${BOOK_PUBLIC_COLUMNS}, shares_count, saves_count, unique_views_count, reading_sessions_count, total_reading_seconds, pages_read_total, last_activity_at`;

function isSchemaMissingError(err: any): boolean {
  const code = String(err?.code || "");
  const msg = String(err?.message || "");
  return (
    code === "42703" ||
    code === "42P01" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    /column .* does not exist/i.test(msg) ||
    /relation .* does not exist/i.test(msg) ||
    /Could not find the/i.test(msg)
  );
}

async function fetchSingleBook(bookId: string): Promise<RawBookAnalyticsRecord & { channel?: any }> {
  const ext = await (supabase as any)
    .from("books")
    .select(
      `${EXTENDED_BOOK_COLUMNS}, channel:channels!books_channel_id_fkey(id, name, avatar_url, user_id, subscribers_count)`,
    )
    .eq("id", bookId)
    .single();
  if (!ext.error) return ext.data;
  if (!isSchemaMissingError(ext.error)) throw ext.error;

  const fb = await (supabase as any)
    .from("books")
    .select(
      `${BOOK_PUBLIC_COLUMNS}, channel:channels!books_channel_id_fkey(id, name, avatar_url, user_id, subscribers_count)`,
    )
    .eq("id", bookId)
    .single();
  if (fb.error) throw fb.error;
  return fb.data;
}

export interface BookAnalyticsDetailData {
  book: RawBookAnalyticsRecord & { channel?: any };
  metrics: BookAnalyticsMetrics;
  lifetimeMetrics: BookAnalyticsMetrics;
  timeSeries: AnalyticsTimeSeriesPoint[];
  comparison: {
    views: PeriodDeltaMetric;
    downloads: PeriodDeltaMetric;
    likes: PeriodDeltaMetric;
    comments: PeriodDeltaMetric;
    shares: PeriodDeltaMetric;
    readingSessions: PeriodDeltaMetric;
  };
  lastSyncedAt: string;
}

export function useBookAnalytics(options: {
  bookId?: string;
  preset?: AnalyticsTimeRangePreset;
  customStart?: string;
  customEnd?: string;
}) {
  const { bookId, preset = "all", customStart, customEnd } = options;
  const queryClient = useQueryClient();

  const range = useMemo(
    () => resolveDateRange(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  );

  // Scoped Realtime + online recovery (1 subscription per bookId)
  useEffect(() => {
    if (!bookId) return;

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["book-analytics-raw", bookId] });
      queryClient.invalidateQueries({ queryKey: ["book", bookId] });
      queryClient.invalidateQueries({ queryKey: ["books", "detail", bookId] });
    };

    const instanceSuffix = Math.random().toString(36).slice(2, 9);
    const rt = supabase
      .channel(`book-analytics-rt-${bookId}-${instanceSuffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "books", filter: `id=eq.${bookId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "book_analytics_events", filter: `book_id=eq.${bookId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "likes", filter: `book_id=eq.${bookId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "book_comments", filter: `book_id=eq.${bookId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "saved_books", filter: `book_id=eq.${bookId}` },
        invalidate,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") invalidate();
      });

    window.addEventListener("online", invalidate);

    return () => {
      window.removeEventListener("online", invalidate);
      supabase.removeChannel(rt);
    };
  }, [bookId, queryClient]);

  const rawQuery = useQuery({
    queryKey: ["book-analytics-raw", bookId],
    queryFn: async () => {
      if (!bookId) return null;
      const book = await fetchSingleBook(bookId);

      const [savedRes, progressRes, evRes] = await Promise.all([
        (supabase as any)
          .from("saved_books")
          .select("book_id, user_id, created_at")
          .eq("book_id", bookId),
        (supabase as any)
          .from("book_reading_progress")
          .select("book_id, user_id, last_read_at")
          .eq("book_id", bookId),
        (supabase as any)
          .from("book_analytics_events")
          .select("id, book_id, channel_id, user_id, session_id, event_type, duration_seconds, pages_read, created_at")
          .eq("book_id", bookId)
          .order("created_at", { ascending: false })
          .limit(3000),
      ]);

      const filteredSaved = (savedRes.data || []).filter((r: any) => !r.book_id || r.book_id === bookId);
      const bookmarkCount = filteredSaved.length;
      const readers = new Set<string>();
      for (const r of progressRes.data || []) {
        if ((!r.book_id || r.book_id === bookId) && r.user_id) readers.add(r.user_id);
      }

      const viewers = new Set<string>();
      let events: AnalyticsEventRecord[] = [];
      let hasEventHistory = false;

      if (!evRes.error && Array.isArray(evRes.data)) {
        events = evRes.data as AnalyticsEventRecord[];
        hasEventHistory = events.length > 0;
        for (const ev of events) {
          const actor = ev.user_id || ev.session_id;
          if (!actor) continue;
          if (ev.event_type === "view") viewers.add(actor);
          if (ev.event_type === "reading_session") readers.add(actor);
        }
      } else {
        // Fallback synthesis from existing timestamped tables
        const [counterRes, likesRes, commentsRes] = await Promise.all([
          (supabase as any)
            .from("book_counter_events")
            .select("id, book_id, user_id, kind, created_at")
            .eq("book_id", bookId),
          (supabase as any)
            .from("likes")
            .select("id, book_id, user_id, created_at")
            .eq("book_id", bookId),
          (supabase as any)
            .from("book_comments")
            .select("id, book_id, user_id, created_at")
            .eq("book_id", bookId),
        ]);

        for (const row of counterRes.data || []) {
          const kind = row.kind === "download" ? "download" : "view";
          if (kind === "view" && row.user_id) viewers.add(row.user_id);
          events.push({
            id: `cnt-${row.id}`,
            book_id: bookId,
            channel_id: book.channel_id,
            user_id: row.user_id,
            event_type: kind,
            created_at: row.created_at,
          });
        }
        for (const row of likesRes.data || []) {
          events.push({
            id: `like-${row.id}`,
            book_id: bookId,
            channel_id: book.channel_id,
            user_id: row.user_id,
            event_type: "like",
            created_at: row.created_at || new Date().toISOString(),
          });
        }
        for (const row of commentsRes.data || []) {
          events.push({
            id: `cmt-${row.id}`,
            book_id: bookId,
            channel_id: book.channel_id,
            user_id: row.user_id,
            event_type: "comment",
            created_at: row.created_at || new Date().toISOString(),
          });
        }
        for (const row of savedRes.data || []) {
          events.push({
            id: `sav-${row.user_id}`,
            book_id: bookId,
            channel_id: book.channel_id,
            user_id: row.user_id,
            event_type: "bookmark",
            created_at: row.created_at || new Date().toISOString(),
          });
        }
        hasEventHistory = events.length > 0;
      }

      return {
        book,
        events,
        bookmarkCount,
        viewers,
        readers,
        hasEventHistory,
        fetchedAt: new Date().toISOString(),
      };
    },
    enabled: !!bookId,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    staleTime: 1500,
  });

  const detail: BookAnalyticsDetailData | null = useMemo(() => {
    const raw = rawQuery.data;
    if (!raw) return null;

    const now = new Date();
    const allRange = resolveDateRange("all", undefined, undefined, now);
    const prevRange = resolvePreviousDateRange(range, now);

    const [lifetimeMetrics] = buildBookAnalyticsList({
      books: [raw.book],
      events: raw.events,
      bookmarkCountsByBook: { [raw.book.id]: raw.bookmarkCount },
      uniqueViewersByBook: { [raw.book.id]: raw.viewers },
      uniqueReadersByBook: { [raw.book.id]: raw.readers },
      range: allRange,
      hasEventHistory: raw.hasEventHistory,
    });

    const metrics =
      range.preset === "all"
        ? lifetimeMetrics
        : buildBookAnalyticsList({
            books: [raw.book],
            events: raw.events,
            bookmarkCountsByBook: { [raw.book.id]: raw.bookmarkCount },
            uniqueViewersByBook: { [raw.book.id]: raw.viewers },
            uniqueReadersByBook: { [raw.book.id]: raw.readers },
            range,
            hasEventHistory: raw.hasEventHistory,
          })[0];

    const [prevMetrics] = buildBookAnalyticsList({
      books: [raw.book],
      events: raw.events,
      range: prevRange,
      hasEventHistory: raw.hasEventHistory,
    });

    const [compMetrics] =
      range.preset === "all"
        ? buildBookAnalyticsList({
            books: [raw.book],
            events: raw.events,
            range: resolveDateRange("28d", undefined, undefined, now),
            hasEventHistory: raw.hasEventHistory,
          })
        : [metrics];

    const comparison = {
      views: computePeriodDelta(compMetrics.totalViews, prevMetrics.totalViews),
      downloads: computePeriodDelta(compMetrics.totalDownloads, prevMetrics.totalDownloads),
      likes: computePeriodDelta(compMetrics.totalLikes, prevMetrics.totalLikes),
      comments: computePeriodDelta(compMetrics.totalComments, prevMetrics.totalComments),
      shares: computePeriodDelta(compMetrics.totalShares, prevMetrics.totalShares),
      readingSessions: computePeriodDelta(
        compMetrics.totalReadingSessions,
        prevMetrics.totalReadingSessions,
      ),
    };

    const timeSeries = buildAnalyticsTimeSeries({
      events: raw.events,
      range,
      now,
    });

    return {
      book: raw.book,
      metrics,
      lifetimeMetrics,
      timeSeries,
      comparison,
      lastSyncedAt: raw.fetchedAt,
    };
  }, [rawQuery.data, range]);

  return {
    detail,
    isLoading: rawQuery.isLoading,
    isError: rawQuery.isError,
    error: rawQuery.error,
    refetch: rawQuery.refetch,
  };
}
