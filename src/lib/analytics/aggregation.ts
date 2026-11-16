import type {
  AnalyticsDateRange,
  AnalyticsEventRecord,
  AnalyticsTimeRangePreset,
  AnalyticsTimeSeriesPoint,
  BookAnalyticsMetrics,
  BookPerformanceSort,
  ChannelAnalyticsTotals,
  PeriodDeltaMetric,
  RawBookAnalyticsRecord,
  SubscriptionEventRecord,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

export function resolveDateRange(
  preset: AnalyticsTimeRangePreset,
  customStart?: string,
  customEnd?: string,
  now: Date = new Date(),
): AnalyticsDateRange {
  const todayStart = startOfUtcDay(now);
  const todayEnd = endOfUtcDay(now);

  switch (preset) {
    case "today":
      return { preset, start: todayStart, end: todayEnd, label: "Today" };
    case "yesterday": {
      const y = new Date(todayStart.getTime() - DAY_MS);
      return { preset, start: startOfUtcDay(y), end: endOfUtcDay(y), label: "Yesterday" };
    }
    case "7d":
      return {
        preset,
        start: new Date(todayStart.getTime() - 6 * DAY_MS),
        end: todayEnd,
        label: "Last 7 Days",
      };
    case "28d":
      return {
        preset,
        start: new Date(todayStart.getTime() - 27 * DAY_MS),
        end: todayEnd,
        label: "Last 28 Days",
      };
    case "90d":
      return {
        preset,
        start: new Date(todayStart.getTime() - 89 * DAY_MS),
        end: todayEnd,
        label: "Last 90 Days",
      };
    case "365d":
      return {
        preset,
        start: new Date(todayStart.getTime() - 364 * DAY_MS),
        end: todayEnd,
        label: "Last 365 Days",
      };
    case "custom": {
      const parsedStart = customStart ? new Date(`${customStart}T00:00:00.000Z`) : todayStart;
      const parsedEnd = customEnd ? new Date(`${customEnd}T23:59:59.999Z`) : todayEnd;
      const start = Number.isNaN(parsedStart.getTime()) ? todayStart : parsedStart;
      const end = Number.isNaN(parsedEnd.getTime()) ? todayEnd : parsedEnd;
      const orderedStart = start.getTime() <= end.getTime() ? start : end;
      const orderedEnd = start.getTime() <= end.getTime() ? end : start;
      return {
        preset,
        start: orderedStart,
        end: orderedEnd,
        label: "Custom Range",
      };
    }
    case "all":
    default:
      return { preset: "all", start: null, end: null, label: "All Time" };
  }
}

export function resolvePreviousDateRange(
  range: AnalyticsDateRange,
  now: Date = new Date(),
): AnalyticsDateRange {
  if (!range.start || !range.end) {
    // Compare last 30 days vs preceding 30 days when "All Time" is selected
    const current30 = resolveDateRange("28d", undefined, undefined, now);
    const span = (current30.end!.getTime() - current30.start!.getTime()) + 1;
    return {
      preset: "custom",
      start: new Date(current30.start!.getTime() - span),
      end: new Date(current30.start!.getTime() - 1),
      label: "Previous 28 Days",
    };
  }
  const span = Math.max(DAY_MS, range.end.getTime() - range.start.getTime() + 1);
  return {
    preset: "custom",
    start: new Date(range.start.getTime() - span),
    end: new Date(range.start.getTime() - 1),
    label: "Previous Period",
  };
}

export function isTimestampInRange(iso: string | null | undefined, range: AnalyticsDateRange): boolean {
  if (!range.start && !range.end) return true;
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return false;
  if (range.start && ts < range.start.getTime()) return false;
  if (range.end && ts > range.end.getTime()) return false;
  return true;
}

export function computePeriodDelta(current: number, previous: number): PeriodDeltaMetric {
  const change = current - previous;
  const changePercent = previous > 0 ? Math.round(((change / previous) * 100) * 10) / 10 : current > 0 ? 100 : 0;
  return { current, previous, change, changePercent };
}

/**
 * Builds authoritative per-book analytics strictly isolated per bookId.
 * When date-filtered events are provided for a non-"all" preset, counts come strictly from events in that window.
 * For "all", authoritative persisted book counters serve as the baseline, enriched with session/event totals.
 */
export function buildBookAnalyticsList(options: {
  books: RawBookAnalyticsRecord[];
  events?: AnalyticsEventRecord[];
  bookmarkCountsByBook?: Record<string, number>;
  uniqueViewersByBook?: Record<string, Set<string>>;
  uniqueReadersByBook?: Record<string, Set<string>>;
  range: AnalyticsDateRange;
  hasEventHistory?: boolean;
}): BookAnalyticsMetrics[] {
  const {
    books,
    events = [],
    bookmarkCountsByBook = {},
    uniqueViewersByBook = {},
    uniqueReadersByBook = {},
    range,
    hasEventHistory = false,
  } = options;

  const isAllTime = range.preset === "all";

  return books.map((book) => {
    const bookEvents = events.filter(
      (ev) => ev.book_id === book.id && isTimestampInRange(ev.created_at, range),
    );

    if (isAllTime) {
      const totalViews = Number(book.views_count || 0);
      const totalDownloads = Number(book.downloads_count || 0);
      const totalLikes = Number(book.likes_count || 0);
      const totalComments = Number(book.comments_count || 0);
      const totalShares = Number(book.shares_count || 0);
      const totalBookmarks = Math.max(
        Number(book.saves_count || 0),
        bookmarkCountsByBook[book.id] || 0,
      );

      let eventSessions = 0;
      let eventReadingSeconds = 0;
      let eventPagesRead = 0;
      const eventViewers = new Set<string>(uniqueViewersByBook[book.id] || []);
      const eventReaders = new Set<string>(uniqueReadersByBook[book.id] || []);
      let latestTs = book.last_activity_at || book.created_at;

      for (const ev of bookEvents) {
        if (!latestTs || new Date(ev.created_at).getTime() > new Date(latestTs).getTime()) {
          latestTs = ev.created_at;
        }
        const actor = ev.user_id || ev.session_id;
        if (ev.event_type === "view" && actor) eventViewers.add(actor);
        if (ev.event_type === "reading_session") {
          eventSessions += 1;
          eventReadingSeconds += Number(ev.duration_seconds || 0);
          eventPagesRead += Number(ev.pages_read || 0);
          if (actor) eventReaders.add(actor);
        }
      }

      const totalReadingSessions = Math.max(Number(book.reading_sessions_count || 0), eventSessions);
      const totalReadingTimeSeconds = Math.max(Number(book.total_reading_seconds || 0), eventReadingSeconds);
      const totalPagesRead = Math.max(Number(book.pages_read_total || 0), eventPagesRead);
      const uniqueViews = Math.max(
        Number(book.unique_views_count || 0),
        eventViewers.size,
        totalViews > 0 ? Math.min(totalViews, eventViewers.size || totalViews) : 0,
      );
      const uniqueReaders = Math.max(Number(book.unique_readers_count || 0), eventReaders.size);
      const avgReadingDurationSeconds =
        totalReadingSessions > 0 ? Math.round(totalReadingTimeSeconds / totalReadingSessions) : 0;
      const engagementScore = totalLikes + totalComments + totalDownloads + totalShares + totalBookmarks;
      const engagementRatePercent =
        totalViews > 0 ? Math.round(((engagementScore / totalViews) * 100) * 10) / 10 : 0;

      return {
        bookId: book.id,
        channelId: book.channel_id,
        title: book.title,
        author: book.author,
        coverUrl: book.cover_url,
        category: book.category,
        visibility: book.visibility || "public",
        publishedAt: book.created_at,
        lastActivityAt: latestTs || null,
        totalViews,
        uniqueViews,
        totalDownloads,
        totalLikes,
        totalComments,
        totalShares,
        totalBookmarks,
        totalReadingSessions,
        totalReadingTimeSeconds,
        avgReadingDurationSeconds,
        totalPagesRead,
        uniqueReaders,
        engagementScore,
        engagementRatePercent,
      };
    }

    // Filtered date range: strictly aggregate from timestamped events (do NOT reuse lifetime totals!)
    let totalViews = 0;
    let totalDownloads = 0;
    let likesDelta = 0;
    let totalComments = 0;
    let totalShares = 0;
    let bookmarksDelta = 0;
    let totalReadingSessions = 0;
    let totalReadingTimeSeconds = 0;
    let totalPagesRead = 0;
    const viewers = new Set<string>();
    const readers = new Set<string>();
    let lastActivityAt: string | null = null;

    if (hasEventHistory || bookEvents.length > 0) {
      for (const ev of bookEvents) {
        if (!lastActivityAt || new Date(ev.created_at).getTime() > new Date(lastActivityAt).getTime()) {
          lastActivityAt = ev.created_at;
        }
        const actor = ev.user_id || ev.session_id;
        switch (ev.event_type) {
          case "view":
            totalViews += 1;
            if (actor) viewers.add(actor);
            break;
          case "download":
            totalDownloads += 1;
            break;
          case "like":
            likesDelta += 1;
            break;
          case "unlike":
            likesDelta = Math.max(0, likesDelta - 1);
            break;
          case "comment":
            totalComments += 1;
            break;
          case "share":
            totalShares += 1;
            break;
          case "bookmark":
            bookmarksDelta += 1;
            break;
          case "unbookmark":
            bookmarksDelta = Math.max(0, bookmarksDelta - 1);
            break;
          case "reading_session":
            totalReadingSessions += 1;
            totalReadingTimeSeconds += Number(ev.duration_seconds || 0);
            totalPagesRead += Number(ev.pages_read || 0);
            if (actor) readers.add(actor);
            break;
        }
      }
    }

    const uniqueViews = viewers.size;
    const uniqueReaders = readers.size;
    const avgReadingDurationSeconds =
      totalReadingSessions > 0 ? Math.round(totalReadingTimeSeconds / totalReadingSessions) : 0;
    const engagementScore =
      likesDelta + totalComments + totalDownloads + totalShares + bookmarksDelta;
    const engagementRatePercent =
      totalViews > 0 ? Math.round(((engagementScore / totalViews) * 100) * 10) / 10 : 0;

    return {
      bookId: book.id,
      channelId: book.channel_id,
      title: book.title,
      author: book.author,
      coverUrl: book.cover_url,
      category: book.category,
      visibility: book.visibility || "public",
      publishedAt: book.created_at,
      lastActivityAt,
      totalViews,
      uniqueViews,
      totalDownloads,
      totalLikes: likesDelta,
      totalComments,
      totalShares,
      totalBookmarks: bookmarksDelta,
      totalReadingSessions,
      totalReadingTimeSeconds,
      avgReadingDurationSeconds,
      totalPagesRead,
      uniqueReaders,
      engagementScore,
      engagementRatePercent,
    };
  });
}

/**
 * Automatically calculates channel-level totals by summing across eligible channel books.
 * Unique readers uses distinct identities across the channel (NOT summing per-book unique counts).
 */
export function aggregateChannelTotals(options: {
  bookMetrics: BookAnalyticsMetrics[];
  totalSubscribers: number;
  distinctChannelReaders?: Set<string>;
  distinctChannelViewers?: Set<string>;
  subscriptionEvents?: SubscriptionEventRecord[];
  range: AnalyticsDateRange;
}): ChannelAnalyticsTotals {
  const {
    bookMetrics,
    totalSubscribers,
    distinctChannelReaders,
    distinctChannelViewers,
    subscriptionEvents = [],
    range,
  } = options;

  let totalViews = 0;
  let sumUniqueViews = 0;
  let totalDownloads = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalBookmarks = 0;
  let totalReadingSessions = 0;
  let totalReadingTimeSeconds = 0;
  let totalPagesRead = 0;
  let maxPerBookReaders = 0;

  for (const b of bookMetrics) {
    totalViews += b.totalViews;
    sumUniqueViews += b.uniqueViews;
    totalDownloads += b.totalDownloads;
    totalLikes += b.totalLikes;
    totalComments += b.totalComments;
    totalShares += b.totalShares;
    totalBookmarks += b.totalBookmarks;
    totalReadingSessions += b.totalReadingSessions;
    totalReadingTimeSeconds += b.totalReadingTimeSeconds;
    totalPagesRead += b.totalPagesRead;
    if (b.uniqueReaders > maxPerBookReaders) {
      maxPerBookReaders = b.uniqueReaders;
    }
  }

  let newSubscribersInRange = 0;
  let unsubscribedInRange = 0;
  for (const subEv of subscriptionEvents) {
    if (!isTimestampInRange(subEv.created_at, range)) continue;
    if (subEv.event_type === "subscribe") newSubscribersInRange += 1;
    else if (subEv.event_type === "unsubscribe") unsubscribedInRange += 1;
  }

  const avgReadingDurationSeconds =
    totalReadingSessions > 0 ? Math.round(totalReadingTimeSeconds / totalReadingSessions) : 0;

  // Use distinct user identities if tracked; never blindly sum individual book unique-reader counts
  const uniqueReaders =
    distinctChannelReaders && distinctChannelReaders.size > 0
      ? distinctChannelReaders.size
      : maxPerBookReaders;

  const uniqueViews =
    distinctChannelViewers && distinctChannelViewers.size > 0
      ? distinctChannelViewers.size
      : Math.min(totalViews, sumUniqueViews);

  return {
    totalBooks: bookMetrics.length,
    totalSubscribers,
    newSubscribersInRange,
    unsubscribedInRange,
    netSubscriberGrowth: newSubscribersInRange - unsubscribedInRange,
    totalViews,
    uniqueViews,
    totalDownloads,
    totalLikes,
    totalComments,
    totalShares,
    totalBookmarks,
    totalReadingSessions,
    totalReadingTimeSeconds,
    avgReadingDurationSeconds,
    totalPagesRead,
    uniqueReaders,
  };
}

export function sortBookMetrics(
  books: BookAnalyticsMetrics[],
  sortBy: BookPerformanceSort,
): BookAnalyticsMetrics[] {
  return [...books].sort((a, b) => {
    switch (sortBy) {
      case "downloads":
        return b.totalDownloads - a.totalDownloads || b.totalViews - a.totalViews;
      case "likes":
        return b.totalLikes - a.totalLikes || b.totalViews - a.totalViews;
      case "comments":
        return b.totalComments - a.totalComments || b.totalViews - a.totalViews;
      case "shares":
        return b.totalShares - a.totalShares || b.totalViews - a.totalViews;
      case "newest": {
        const tA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const tB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return tB - tA;
      }
      case "oldest": {
        const tA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const tB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return tA - tB;
      }
      case "views":
      default:
        return b.totalViews - a.totalViews || b.totalLikes - a.totalLikes;
    }
  });
}

export function buildAnalyticsTimeSeries(options: {
  events: AnalyticsEventRecord[];
  subscriptionEvents?: SubscriptionEventRecord[];
  range: AnalyticsDateRange;
  now?: Date;
}): AnalyticsTimeSeriesPoint[] {
  const { events, subscriptionEvents = [], range, now = new Date() } = options;

  // Determine bucket window (default to last 14 days when "All Time" has sparse events or span across range)
  const effectiveEnd = range.end ? endOfUtcDay(range.end) : endOfUtcDay(now);
  let effectiveStart: Date;
  if (range.start) {
    effectiveStart = startOfUtcDay(range.start);
  } else {
    const timestamps = [
      ...events.map((e) => new Date(e.created_at).getTime()),
      ...subscriptionEvents.map((e) => new Date(e.created_at).getTime()),
    ].filter((t) => !Number.isNaN(t));
    const minTs = timestamps.length > 0 ? Math.min(...timestamps) : effectiveEnd.getTime() - 13 * DAY_MS;
    const minBounded = Math.max(minTs, effectiveEnd.getTime() - 89 * DAY_MS);
    effectiveStart = startOfUtcDay(new Date(Math.min(minBounded, effectiveEnd.getTime() - 6 * DAY_MS)));
  }

  const buckets = new Map<string, AnalyticsTimeSeriesPoint>();
  const dayCursor = new Date(effectiveStart.getTime());
  let guard = 0;
  while (dayCursor.getTime() <= effectiveEnd.getTime() && guard < 370) {
    const dateKey = dayCursor.toISOString().slice(0, 10);
    const label = dayCursor.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    buckets.set(dateKey, {
      dateKey,
      label,
      views: 0,
      downloads: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      bookmarks: 0,
      readingSessions: 0,
      readingMinutes: 0,
      engagement: 0,
      subscribersGained: 0,
      subscribersLost: 0,
    });
    dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
    guard += 1;
  }

  for (const ev of events) {
    if (!isTimestampInRange(ev.created_at, range)) continue;
    const key = ev.created_at.slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;

    switch (ev.event_type) {
      case "view":
        bucket.views += 1;
        break;
      case "download":
        bucket.downloads += 1;
        bucket.engagement += 1;
        break;
      case "like":
        bucket.likes += 1;
        bucket.engagement += 1;
        break;
      case "comment":
        bucket.comments += 1;
        bucket.engagement += 1;
        break;
      case "share":
        bucket.shares += 1;
        bucket.engagement += 1;
        break;
      case "bookmark":
        bucket.bookmarks += 1;
        bucket.engagement += 1;
        break;
      case "reading_session":
        bucket.readingSessions += 1;
        bucket.readingMinutes += Math.round((Number(ev.duration_seconds || 0) / 60) * 10) / 10;
        bucket.engagement += 1;
        break;
    }
  }

  for (const subEv of subscriptionEvents) {
    if (!isTimestampInRange(subEv.created_at, range)) continue;
    const key = subEv.created_at.slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (subEv.event_type === "subscribe") bucket.subscribersGained += 1;
    else if (subEv.event_type === "unsubscribe") bucket.subscribersLost += 1;
  }

  return Array.from(buckets.values());
}

export function formatReadingDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) return `${safe}s`;
  const mins = Math.floor(safe / 60);
  const remSecs = safe % 60;
  if (mins < 60) return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}
