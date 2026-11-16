export type AnalyticsTimeRangePreset =
  | "today"
  | "yesterday"
  | "7d"
  | "28d"
  | "90d"
  | "365d"
  | "all"
  | "custom";

export type BookPerformanceSort =
  | "views"
  | "downloads"
  | "likes"
  | "comments"
  | "shares"
  | "newest"
  | "oldest";

export type AnalyticsEventKind =
  | "view"
  | "download"
  | "like"
  | "unlike"
  | "comment"
  | "share"
  | "bookmark"
  | "unbookmark"
  | "reading_session";

export interface AnalyticsDateRange {
  preset: AnalyticsTimeRangePreset;
  start: Date | null;
  end: Date | null;
  label: string;
}

export interface RawBookAnalyticsRecord {
  id: string;
  channel_id: string;
  title: string;
  author: string;
  cover_url: string | null;
  category: string | null;
  visibility?: string | null;
  created_at: string | null;
  pages?: number | null;
  views_count: number | null;
  unique_views_count?: number | null;
  downloads_count: number | null;
  likes_count: number | null;
  comments_count: number | null;
  shares_count?: number | null;
  saves_count?: number | null;
  reading_sessions_count?: number | null;
  total_reading_seconds?: number | null;
  pages_read_total?: number | null;
  unique_readers_count?: number | null;
  last_activity_at?: string | null;
}

export interface AnalyticsEventRecord {
  id: string;
  book_id: string;
  channel_id: string;
  user_id?: string | null;
  session_id?: string | null;
  event_type: AnalyticsEventKind | string;
  duration_seconds?: number | null;
  pages_read?: number | null;
  created_at: string;
}

export interface SubscriptionEventRecord {
  id: string;
  channel_id: string;
  user_id: string;
  event_type: "subscribe" | "unsubscribe";
  created_at: string;
}

export interface BookAnalyticsMetrics {
  bookId: string;
  channelId: string;
  title: string;
  author: string;
  coverUrl: string | null;
  category: string | null;
  visibility: string;
  publishedAt: string | null;
  lastActivityAt: string | null;
  totalViews: number;
  uniqueViews: number;
  totalDownloads: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalBookmarks: number;
  totalReadingSessions: number;
  totalReadingTimeSeconds: number;
  avgReadingDurationSeconds: number;
  totalPagesRead: number;
  uniqueReaders: number;
  engagementScore: number;
  engagementRatePercent: number;
}

export interface ChannelAnalyticsTotals {
  totalBooks: number;
  totalSubscribers: number;
  newSubscribersInRange: number;
  unsubscribedInRange: number;
  netSubscriberGrowth: number;
  totalViews: number;
  uniqueViews: number;
  totalDownloads: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalBookmarks: number;
  totalReadingSessions: number;
  totalReadingTimeSeconds: number;
  avgReadingDurationSeconds: number;
  totalPagesRead: number;
  uniqueReaders: number;
}

export interface AnalyticsTimeSeriesPoint {
  dateKey: string;
  label: string;
  views: number;
  downloads: number;
  likes: number;
  comments: number;
  shares: number;
  bookmarks: number;
  readingSessions: number;
  readingMinutes: number;
  engagement: number;
  subscribersGained: number;
  subscribersLost: number;
}

export interface PeriodDeltaMetric {
  current: number;
  previous: number;
  change: number;
  changePercent: number | null;
}

export interface ChannelAnalyticsDashboardData {
  range: AnalyticsDateRange;
  totals: ChannelAnalyticsTotals;
  lifetimeTotals: ChannelAnalyticsTotals;
  books: BookAnalyticsMetrics[];
  timeSeries: AnalyticsTimeSeriesPoint[];
  comparison: {
    views: PeriodDeltaMetric;
    downloads: PeriodDeltaMetric;
    likes: PeriodDeltaMetric;
    comments: PeriodDeltaMetric;
    shares: PeriodDeltaMetric;
    bookmarks: PeriodDeltaMetric;
    newSubscribers: PeriodDeltaMetric;
  };
  insights: {
    todayViews: number;
    yesterdayViews: number;
    last7DaysDownloads: number;
    mostPopularBook: BookAnalyticsMetrics | null;
    mostEngagedBook: BookAnalyticsMetrics | null;
  };
  lastSyncedAt: string;
}
