import { describe, it, expect } from "vitest";
import {
  aggregateChannelTotals,
  buildAnalyticsTimeSeries,
  buildBookAnalyticsList,
  computePeriodDelta,
  formatReadingDuration,
  resolveDateRange,
  sortBookMetrics,
} from "./aggregation";
import type { AnalyticsEventRecord, RawBookAnalyticsRecord } from "./types";

describe("Bookshelf Analytics Aggregation & Channel Totals", () => {
  it("computes exact 4-book channel aggregate totals with zero cross-book contamination", () => {
    const books: RawBookAnalyticsRecord[] = [
      {
        id: "book-1",
        channel_id: "ch-1",
        title: "Book One",
        author: "Author",
        cover_url: null,
        category: "Fiction",
        created_at: "2026-10-01T10:00:00Z",
        views_count: 7,
        downloads_count: 5,
        likes_count: 6,
        comments_count: 2,
        shares_count: 3,
        saves_count: 4,
      },
      {
        id: "book-2",
        channel_id: "ch-1",
        title: "Book Two",
        author: "Author",
        cover_url: null,
        category: "Fiction",
        created_at: "2026-10-02T10:00:00Z",
        views_count: 12,
        downloads_count: 10,
        likes_count: 10,
        comments_count: 5,
        shares_count: 4,
        saves_count: 7,
      },
      {
        id: "book-3",
        channel_id: "ch-1",
        title: "Book Three",
        author: "Author",
        cover_url: null,
        category: "Fiction",
        created_at: "2026-10-03T10:00:00Z",
        views_count: 15,
        downloads_count: 15,
        likes_count: 12,
        comments_count: 8,
        shares_count: 6,
        saves_count: 9,
      },
      {
        id: "book-4",
        channel_id: "ch-1",
        title: "Book Four",
        author: "Author",
        cover_url: null,
        category: "Fiction",
        created_at: "2026-10-04T10:00:00Z",
        views_count: 20,
        downloads_count: 80,
        likes_count: 90,
        comments_count: 12,
        shares_count: 10,
        saves_count: 15,
      },
    ];

    const range = resolveDateRange("all");
    const bookMetrics = buildBookAnalyticsList({ books, range });

    // Individual books keep their exact independent metrics
    expect(bookMetrics[0].totalViews).toBe(7);
    expect(bookMetrics[1].totalDownloads).toBe(10);
    expect(bookMetrics[2].totalLikes).toBe(12);
    expect(bookMetrics[3].totalLikes).toBe(90);

    // Distinct channel readers across multiple books must deduplicate user IDs
    const distinctReaders = new Set(["reader-a", "reader-b", "reader-c"]);
    const totals = aggregateChannelTotals({
      bookMetrics,
      totalSubscribers: 42,
      distinctChannelReaders: distinctReaders,
      range,
    });

    expect(totals.totalBooks).toBe(4);
    expect(totals.totalViews).toBe(54);
    expect(totals.totalDownloads).toBe(110);
    expect(totals.totalLikes).toBe(118);
    expect(totals.totalComments).toBe(27);
    expect(totals.totalShares).toBe(23);
    expect(totals.totalBookmarks).toBe(35);
    expect(totals.totalSubscribers).toBe(42);
    expect(totals.uniqueReaders).toBe(3);
  });

  it("uses timestamped event windows rather than lifetime counters for date filters", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const books: RawBookAnalyticsRecord[] = [
      {
        id: "book-1",
        channel_id: "ch-1",
        title: "Book One",
        author: "Author",
        cover_url: null,
        category: "Fiction",
        created_at: "2026-01-01T00:00:00Z",
        views_count: 500,
        downloads_count: 200,
        likes_count: 100,
        comments_count: 50,
      },
    ];
    const events: AnalyticsEventRecord[] = [
      { id: "e1", book_id: "book-1", channel_id: "ch-1", user_id: "u1", event_type: "view", created_at: "2026-11-15T08:00:00Z" },
      { id: "e2", book_id: "book-1", channel_id: "ch-1", user_id: "u2", event_type: "view", created_at: "2026-11-14T08:00:00Z" },
      { id: "e3", book_id: "book-1", channel_id: "ch-1", user_id: "u1", event_type: "download", created_at: "2026-11-15T09:00:00Z" },
      { id: "e4", book_id: "book-1", channel_id: "ch-1", user_id: "u1", event_type: "view", created_at: "2026-10-01T08:00:00Z" },
    ];

    const todayRange = resolveDateRange("today", undefined, undefined, now);
    const todayMetrics = buildBookAnalyticsList({ books, events, range: todayRange, hasEventHistory: true });
    expect(todayMetrics[0].totalViews).toBe(1);
    expect(todayMetrics[0].totalDownloads).toBe(1);

    const last7Range = resolveDateRange("7d", undefined, undefined, now);
    const last7Metrics = buildBookAnalyticsList({ books, events, range: last7Range, hasEventHistory: true });
    expect(last7Metrics[0].totalViews).toBe(2);
    expect(last7Metrics[0].uniqueViews).toBe(2);
  });

  it("sorts channel books and builds time-series & period deltas accurately", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const range = resolveDateRange("7d", undefined, undefined, now);
    const series = buildAnalyticsTimeSeries({
      events: [
        { id: "e1", book_id: "b1", channel_id: "c1", event_type: "view", created_at: "2026-11-15T05:00:00Z" },
        { id: "e2", book_id: "b1", channel_id: "c1", event_type: "like", created_at: "2026-11-15T06:00:00Z" },
      ],
      subscriptionEvents: [
        { id: "s1", channel_id: "c1", user_id: "u9", event_type: "subscribe", created_at: "2026-11-15T06:30:00Z" },
      ],
      range,
      now,
    });
    expect(series.length).toBe(7);
    const todayPoint = series[series.length - 1];
    expect(todayPoint.views).toBe(1);
    expect(todayPoint.likes).toBe(1);
    expect(todayPoint.subscribersGained).toBe(1);

    expect(computePeriodDelta(15, 10)).toEqual({
      current: 15,
      previous: 10,
      change: 5,
      changePercent: 50,
    });
    expect(formatReadingDuration(3720)).toBe("1h 2m");

    const metrics = buildBookAnalyticsList({
      books: [
        { id: "a", channel_id: "c", title: "A", author: "X", cover_url: null, category: null, created_at: "2026-01-01T00:00:00Z", views_count: 10, downloads_count: 50, likes_count: 1, comments_count: 0 },
        { id: "b", channel_id: "c", title: "B", author: "X", cover_url: null, category: null, created_at: "2026-02-01T00:00:00Z", views_count: 40, downloads_count: 5, likes_count: 20, comments_count: 0 },
      ],
      range: resolveDateRange("all"),
    });
    expect(sortBookMetrics(metrics, "downloads").map((m) => m.bookId)).toEqual(["a", "b"]);
    expect(sortBookMetrics(metrics, "likes").map((m) => m.bookId)).toEqual(["b", "a"]);
    expect(sortBookMetrics(metrics, "newest").map((m) => m.bookId)).toEqual(["b", "a"]);
  });
});
