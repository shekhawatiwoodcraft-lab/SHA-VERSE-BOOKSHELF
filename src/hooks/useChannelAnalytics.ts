import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BOOK_PUBLIC_COLUMNS, HIDE_SEED_BOOKS, SEED_BOOK_URL } from "@/lib/constants/bookshelf";
import { excludeSeedBooks } from "@/modules/bookshelf/lib/seedFilter";
import {
  aggregateChannelTotals,
  buildAnalyticsTimeSeries,
  buildBookAnalyticsList,
  computePeriodDelta,
  isTimestampInRange,
  resolveDateRange,
  resolvePreviousDateRange,
} from "@/lib/analytics/aggregation";
import type {
  AnalyticsEventRecord,
  AnalyticsTimeRangePreset,
  ChannelAnalyticsDashboardData,
  RawBookAnalyticsRecord,
  SubscriptionEventRecord,
} from "@/lib/analytics/types";

const EXTENDED_BOOK_COLUMNS =
  `${BOOK_PUBLIC_COLUMNS}, shares_count, saves_count, unique_views_count, reading_sessions_count, total_reading_seconds, pages_read_total, last_activity_at`;

const DAY_MS = 24 * 60 * 60 * 1000;

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

async function fetchChannelBooks(channelId: string): Promise<RawBookAnalyticsRecord[]> {
  const extendedQuery = excludeSeedBooks(
    (supabase as any)
      .from("books")
      .select(EXTENDED_BOOK_COLUMNS)
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false }),
  );
  const { data, error } = await extendedQuery;
  if (!error) {
    return ((data || []) as RawBookAnalyticsRecord[]).filter(
      (b) => !HIDE_SEED_BOOKS || (b as any).book_url !== SEED_BOOK_URL,
    );
  }

  if (!isSchemaMissingError(error)) throw error;

  // Fallback for remote DB before extended columns migration is applied
  const fallbackQuery = excludeSeedBooks(
    (supabase as any)
      .from("books")
      .select(BOOK_PUBLIC_COLUMNS)
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false }),
  );
  const fb = await fallbackQuery;
  if (fb.error) throw fb.error;
  return (fb.data || []) as RawBookAnalyticsRecord[];
}

async function fetchChannelEventsAndFallback(
  channelId: string,
  books: RawBookAnalyticsRecord[],
): Promise<{
  events: AnalyticsEventRecord[];
  subEvents: SubscriptionEventRecord[];
  bookmarkCountsByBook: Record<string, number>;
  uniqueViewersByBook: Record<string, Set<string>>;
  uniqueReadersByBook: Record<string, Set<string>>;
  distinctChannelReaders: Set<string>;
  distinctChannelViewers: Set<string>;
  hasEventHistory: boolean;
}> {
  const bookIds = books.map((b) => b.id);
  const bookmarkCountsByBook: Record<string, number> = {};
  const uniqueViewersByBook: Record<string, Set<string>> = {};
  const uniqueReadersByBook: Record<string, Set<string>> = {};
  const distinctChannelReaders = new Set<string>();
  const distinctChannelViewers = new Set<string>();

  if (bookIds.length === 0) {
    return {
      events: [],
      subEvents: [],
      bookmarkCountsByBook,
      uniqueViewersByBook,
      uniqueReadersByBook,
      distinctChannelReaders,
      distinctChannelViewers,
      hasEventHistory: false,
    };
  }

  // Always read saved_books & reading progress so bookmarks and distinct readers stay exact
  const [savedRes, progressRes] = await Promise.all([
    (supabase as any)
      .from("saved_books")
      .select("book_id, user_id, created_at")
      .in("book_id", bookIds),
    (supabase as any)
      .from("book_reading_progress")
      .select("book_id, user_id, last_read_at")
      .in("book_id", bookIds),
  ]);

  for (const row of savedRes.data || []) {
    bookmarkCountsByBook[row.book_id] = (bookmarkCountsByBook[row.book_id] || 0) + 1;
  }
  for (const row of progressRes.data || []) {
    if (row.user_id) {
      distinctChannelReaders.add(row.user_id);
      if (!uniqueReadersByBook[row.book_id]) uniqueReadersByBook[row.book_id] = new Set();
      uniqueReadersByBook[row.book_id].add(row.user_id);
    }
  }

  // Try rich book_analytics_events table first
  const [evRes, subEvRes] = await Promise.all([
    (supabase as any)
      .from("book_analytics_events")
      .select("id, book_id, channel_id, user_id, session_id, event_type, duration_seconds, pages_read, created_at")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .limit(5000),
    (supabase as any)
      .from("channel_subscription_events")
      .select("id, channel_id, user_id, event_type, created_at")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);

  if (!evRes.error && Array.isArray(evRes.data)) {
    const events = evRes.data as AnalyticsEventRecord[];
    for (const ev of events) {
      const actor = ev.user_id || ev.session_id;
      if (!actor) continue;
      if (ev.event_type === "view") {
        distinctChannelViewers.add(actor);
        if (!uniqueViewersByBook[ev.book_id]) uniqueViewersByBook[ev.book_id] = new Set();
        uniqueViewersByBook[ev.book_id].add(actor);
      } else if (ev.event_type === "reading_session") {
        distinctChannelReaders.add(actor);
        if (!uniqueReadersByBook[ev.book_id]) uniqueReadersByBook[ev.book_id] = new Set();
        uniqueReadersByBook[ev.book_id].add(actor);
      }
    }

    let subEvents: SubscriptionEventRecord[] = [];
    if (!subEvRes.error && Array.isArray(subEvRes.data)) {
      subEvents = subEvRes.data as SubscriptionEventRecord[];
    }

    return {
      events,
      subEvents,
      bookmarkCountsByBook,
      uniqueViewersByBook,
      uniqueReadersByBook,
      distinctChannelReaders,
      distinctChannelViewers,
      hasEventHistory: events.length > 0,
    };
  }

  // Graceful fallback: synthesize real timestamped events from existing tables
  // (book_counter_events, likes, book_comments, saved_books, subscriptions)
  const [counterRes, likesRes, commentsRes, subsRes] = await Promise.all([
    (supabase as any)
      .from("book_counter_events")
      .select("id, book_id, user_id, kind, created_at")
      .in("book_id", bookIds)
      .limit(5000),
    (supabase as any)
      .from("likes")
      .select("id, book_id, user_id, created_at")
      .in("book_id", bookIds)
      .limit(5000),
    (supabase as any)
      .from("book_comments")
      .select("id, book_id, user_id, created_at")
      .in("book_id", bookIds)
      .limit(5000),
    (supabase as any)
      .from("subscriptions")
      .select("id, channel_id, user_id, created_at")
      .eq("channel_id", channelId)
      .limit(2000),
  ]);

  const syntheticEvents: AnalyticsEventRecord[] = [];

  for (const row of counterRes.data || []) {
    const kind = row.kind === "download" ? "download" : "view";
    if (kind === "view" && row.user_id) {
      distinctChannelViewers.add(row.user_id);
      if (!uniqueViewersByBook[row.book_id]) uniqueViewersByBook[row.book_id] = new Set();
      uniqueViewersByBook[row.book_id].add(row.user_id);
    }
    syntheticEvents.push({
      id: `cnt-${row.id}`,
      book_id: row.book_id,
      channel_id: channelId,
      user_id: row.user_id,
      event_type: kind,
      created_at: row.created_at,
    });
  }

  for (const row of likesRes.data || []) {
    syntheticEvents.push({
      id: `like-${row.id}`,
      book_id: row.book_id,
      channel_id: channelId,
      user_id: row.user_id,
      event_type: "like",
      created_at: row.created_at || new Date().toISOString(),
    });
  }

  for (const row of commentsRes.data || []) {
    syntheticEvents.push({
      id: `cmt-${row.id}`,
      book_id: row.book_id,
      channel_id: channelId,
      user_id: row.user_id,
      event_type: "comment",
      created_at: row.created_at || new Date().toISOString(),
    });
  }

  for (const row of savedRes.data || []) {
    syntheticEvents.push({
      id: `sav-${row.book_id}-${row.user_id}`,
      book_id: row.book_id,
      channel_id: channelId,
      user_id: row.user_id,
      event_type: "bookmark",
      created_at: row.created_at || new Date().toISOString(),
    });
  }

  const subEvents: SubscriptionEventRecord[] = (subsRes.data || []).map((s: any) => ({
    id: `sub-${s.id}`,
    channel_id: channelId,
    user_id: s.user_id,
    event_type: "subscribe" as const,
    created_at: s.created_at || new Date().toISOString(),
  }));

  return {
    events: syntheticEvents,
    subEvents,
    bookmarkCountsByBook,
    uniqueViewersByBook,
    uniqueReadersByBook,
    distinctChannelReaders,
    distinctChannelViewers,
    hasEventHistory: syntheticEvents.length > 0,
  };
}

export interface UseChannelAnalyticsOptions {
  channelId?: string;
  preset?: AnalyticsTimeRangePreset;
  customStart?: string;
  customEnd?: string;
  enabled?: boolean;
  subscribeRealtime?: boolean;
}

export function useChannelAnalytics({
  channelId,
  preset = "all",
  customStart,
  customEnd,
  enabled = true,
  subscribeRealtime = true,
}: UseChannelAnalyticsOptions) {
  const queryClient = useQueryClient();
  const bookIdsRef = useRef<Set<string>>(new Set());

  const range = useMemo(
    () => resolveDateRange(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  );

  // Scoped Realtime + Online Reconnect Listener (unique channel instance per mount)
  useEffect(() => {
    if (!channelId || !enabled || !subscribeRealtime) return;

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["channel-analytics-raw", channelId] });
      queryClient.invalidateQueries({ queryKey: ["channel-metrics", channelId] });
      queryClient.invalidateQueries({ queryKey: ["author-channel", channelId] });
      queryClient.invalidateQueries({ queryKey: ["author-books", channelId] });
    };

    const instanceSuffix = Math.random().toString(36).slice(2, 9);
    const rt = supabase
      .channel(`channel-analytics-rt-${channelId}-${instanceSuffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "books", filter: `channel_id=eq.${channelId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "channels", filter: `id=eq.${channelId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `channel_id=eq.${channelId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "book_analytics_events", filter: `channel_id=eq.${channelId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "likes" },
        (payload: any) => {
          const bid = payload?.new?.book_id || payload?.old?.book_id;
          if (bid && bookIdsRef.current.has(bid)) invalidate();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "book_comments" },
        (payload: any) => {
          const bid = payload?.new?.book_id || payload?.old?.book_id;
          if (bid && bookIdsRef.current.has(bid)) invalidate();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "saved_books" },
        (payload: any) => {
          const bid = payload?.new?.book_id || payload?.old?.book_id;
          if (bid && bookIdsRef.current.has(bid)) invalidate();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          invalidate();
        }
      });

    window.addEventListener("online", invalidate);

    return () => {
      window.removeEventListener("online", invalidate);
      supabase.removeChannel(rt);
    };
  }, [channelId, enabled, subscribeRealtime, queryClient]);

  const rawQuery = useQuery({
    queryKey: ["channel-analytics-raw", channelId],
    queryFn: async () => {
      if (!channelId) return null;

      const [channelRes, books] = await Promise.all([
        supabase
          .from("channels")
          .select("id, name, avatar_url, banner_url, description, subscribers_count, user_id, created_at")
          .eq("id", channelId)
          .single(),
        fetchChannelBooks(channelId),
      ]);

      if (channelRes.error) throw channelRes.error;
      bookIdsRef.current = new Set(books.map((b) => b.id));

      const eventPayload = await fetchChannelEventsAndFallback(channelId, books);

      return {
        channel: channelRes.data,
        books,
        ...eventPayload,
        fetchedAt: new Date().toISOString(),
      };
    },
    enabled: !!channelId && enabled,
    // 3-second fallback sync so missed realtime events recover within 3 seconds max
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    staleTime: 1500,
  });

  const dashboard: ChannelAnalyticsDashboardData | null = useMemo(() => {
    const raw = rawQuery.data;
    if (!raw) return null;

    const now = new Date();
    const prevRange = resolvePreviousDateRange(range, now);
    const allRange = resolveDateRange("all", undefined, undefined, now);

    const lifetimeBookMetrics = buildBookAnalyticsList({
      books: raw.books,
      events: raw.events,
      bookmarkCountsByBook: raw.bookmarkCountsByBook,
      uniqueViewersByBook: raw.uniqueViewersByBook,
      uniqueReadersByBook: raw.uniqueReadersByBook,
      range: allRange,
      hasEventHistory: raw.hasEventHistory,
    });

    const filteredBookMetrics =
      range.preset === "all"
        ? lifetimeBookMetrics
        : buildBookAnalyticsList({
            books: raw.books,
            events: raw.events,
            bookmarkCountsByBook: raw.bookmarkCountsByBook,
            uniqueViewersByBook: raw.uniqueViewersByBook,
            uniqueReadersByBook: raw.uniqueReadersByBook,
            range,
            hasEventHistory: raw.hasEventHistory,
          });

    const previousBookMetrics = buildBookAnalyticsList({
      books: raw.books,
      events: raw.events,
      range: prevRange,
      hasEventHistory: raw.hasEventHistory,
    });

    const totalSubscribers = Number(raw.channel?.subscribers_count || 0);

    const lifetimeTotals = aggregateChannelTotals({
      bookMetrics: lifetimeBookMetrics,
      totalSubscribers,
      distinctChannelReaders: raw.distinctChannelReaders,
      distinctChannelViewers: raw.distinctChannelViewers,
      subscriptionEvents: raw.subEvents,
      range: allRange,
    });

    const totals =
      range.preset === "all"
        ? lifetimeTotals
        : aggregateChannelTotals({
            bookMetrics: filteredBookMetrics,
            totalSubscribers,
            subscriptionEvents: raw.subEvents,
            range,
          });

    const previousTotals = aggregateChannelTotals({
      bookMetrics: previousBookMetrics,
      totalSubscribers,
      subscriptionEvents: raw.subEvents,
      range: prevRange,
    });

    // When "all" is selected, compare the current 28d window vs preceding 28d window for growth delta
    const currentCompTotals =
      range.preset === "all"
        ? aggregateChannelTotals({
            bookMetrics: buildBookAnalyticsList({
              books: raw.books,
              events: raw.events,
              range: resolveDateRange("28d", undefined, undefined, now),
              hasEventHistory: raw.hasEventHistory,
            }),
            totalSubscribers,
            subscriptionEvents: raw.subEvents,
            range: resolveDateRange("28d", undefined, undefined, now),
          })
        : totals;

    const comparison = {
      views: computePeriodDelta(currentCompTotals.totalViews, previousTotals.totalViews),
      downloads: computePeriodDelta(currentCompTotals.totalDownloads, previousTotals.totalDownloads),
      likes: computePeriodDelta(currentCompTotals.totalLikes, previousTotals.totalLikes),
      comments: computePeriodDelta(currentCompTotals.totalComments, previousTotals.totalComments),
      shares: computePeriodDelta(currentCompTotals.totalShares, previousTotals.totalShares),
      bookmarks: computePeriodDelta(currentCompTotals.totalBookmarks, previousTotals.totalBookmarks),
      newSubscribers: computePeriodDelta(
        currentCompTotals.newSubscribersInRange,
        previousTotals.newSubscribersInRange,
      ),
    };

    const timeSeries = buildAnalyticsTimeSeries({
      events: raw.events,
      subscriptionEvents: raw.subEvents,
      range,
      now,
    });

    // Insights: Today views, Yesterday views, Last 7 days downloads, Most popular & Most engaged books
    const todayRange = resolveDateRange("today", undefined, undefined, now);
    const yesterdayRange = resolveDateRange("yesterday", undefined, undefined, now);
    const last7Range = resolveDateRange("7d", undefined, undefined, now);

    let todayViews = 0;
    let yesterdayViews = 0;
    let last7DaysDownloads = 0;
    for (const ev of raw.events) {
      if (ev.event_type === "view") {
        if (isTimestampInRange(ev.created_at, todayRange)) todayViews += 1;
        else if (isTimestampInRange(ev.created_at, yesterdayRange)) yesterdayViews += 1;
      } else if (ev.event_type === "download" && isTimestampInRange(ev.created_at, last7Range)) {
        last7DaysDownloads += 1;
      }
    }

    const sortedByPopular = [...filteredBookMetrics].sort((a, b) => b.totalViews - a.totalViews);
    const sortedByEngagement = [...filteredBookMetrics].sort(
      (a, b) => b.engagementScore - a.engagementScore,
    );

    return {
      range,
      totals,
      lifetimeTotals,
      books: filteredBookMetrics,
      timeSeries,
      comparison,
      insights: {
        todayViews,
        yesterdayViews,
        last7DaysDownloads:
          range.preset === "all" && last7DaysDownloads === 0 && raw.events.length === 0
            ? lifetimeTotals.totalDownloads
            : last7DaysDownloads,
        mostPopularBook: sortedByPopular[0] ?? null,
        mostEngagedBook: sortedByEngagement[0] ?? null,
      },
      lastSyncedAt: raw.fetchedAt,
    };
  }, [rawQuery.data, range]);

  return {
    channel: rawQuery.data?.channel ?? null,
    dashboard,
    isLoading: rawQuery.isLoading,
    isError: rawQuery.isError,
    error: rawQuery.error,
    refetch: rawQuery.refetch,
    isFetching: rawQuery.isFetching,
  };
}
