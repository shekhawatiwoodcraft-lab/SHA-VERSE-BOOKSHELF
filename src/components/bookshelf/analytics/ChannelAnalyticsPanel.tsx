import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Bookmark,
  Clock,
  Download,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  Search,
  Share2,
  TrendingUp,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useChannelAnalytics } from "@/hooks/useChannelAnalytics";
import {
  formatCompactNumber,
  formatReadingDuration,
  sortBookMetrics,
} from "@/lib/analytics/aggregation";
import type {
  AnalyticsTimeRangePreset,
  BookPerformanceSort,
  PeriodDeltaMetric,
} from "@/lib/analytics/types";

interface ChannelAnalyticsPanelProps {
  channelId: string;
  compact?: boolean;
}

const PRESET_OPTIONS: { value: AnalyticsTimeRangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 Days" },
  { value: "28d", label: "Last 28 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "365d", label: "Last 365 Days" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom" },
];

const SORT_OPTIONS: { value: BookPerformanceSort; label: string }[] = [
  { value: "views", label: "Most Viewed" },
  { value: "downloads", label: "Most Downloaded" },
  { value: "likes", label: "Most Liked" },
  { value: "comments", label: "Most Commented" },
  { value: "shares", label: "Most Shared" },
  { value: "newest", label: "Recently Published" },
  { value: "oldest", label: "Oldest Published" },
];

function formatDeltaLabel(metric?: PeriodDeltaMetric) {
  if (!metric) return null;
  const pct = metric.changePercent ?? 0;
  const positive = metric.change > 0;
  const negative = metric.change < 0;
  return {
    text: `${positive ? "+" : ""}${pct}% vs prev`,
    positive,
    negative,
  };
}

export const ChannelAnalyticsPanel = ({
  channelId,
  compact = false,
}: ChannelAnalyticsPanelProps) => {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<AnalyticsTimeRangePreset>("all");
  const [customStart, setCustomStart] = useState<string>(() => {
    const d = new Date(Date.now() - 27 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [sortBy, setSortBy] = useState<BookPerformanceSort>("views");
  const [searchTerm, setSearchTerm] = useState("");

  const { dashboard, isLoading, isError, refetch } = useChannelAnalytics({
    channelId,
    preset,
    customStart: preset === "custom" ? customStart : undefined,
    customEnd: preset === "custom" ? customEnd : undefined,
  });

  const filteredAndSortedBooks = useMemo(() => {
    if (!dashboard) return [];
    const q = searchTerm.trim().toLowerCase();
    const filtered = q
      ? dashboard.books.filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            b.author.toLowerCase().includes(q),
        )
      : dashboard.books;
    return sortBookMetrics(filtered, sortBy);
  }, [dashboard, searchTerm, sortBy]);

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="channel-analytics-loading">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, idx) => (
            <Card key={idx} className="p-4 animate-pulse">
              <div className="h-3 w-20 bg-muted rounded mb-3" />
              <div className="h-7 w-16 bg-muted rounded mb-2" />
              <div className="h-3 w-24 bg-muted rounded" />
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="h-72 animate-pulse bg-muted/30" />
          <Card className="h-72 animate-pulse bg-muted/30" />
        </div>
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <Card className="p-8 text-center">
        <BarChart3 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <h3 className="font-semibold mb-1">Unable to load channel analytics</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Please check your connection and try syncing again.
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </Card>
    );
  }

  const { totals, lifetimeTotals, comparison, insights, timeSeries } = dashboard;

  const kpiCards = [
    {
      label: "Total Subscribers",
      value: totals.totalSubscribers.toLocaleString(),
      sub:
        totals.netSubscriberGrowth >= 0
          ? `+${totals.netSubscriberGrowth.toLocaleString()} net in period`
          : `${totals.netSubscriberGrowth.toLocaleString()} net in period`,
      delta: comparison.newSubscribers,
      icon: Users,
      testId: "kpi-subscribers",
    },
    {
      label: "Published Books",
      value: lifetimeTotals.totalBooks.toLocaleString(),
      sub: `${totals.totalBooks.toLocaleString()} active in view`,
      icon: BookOpen,
      testId: "kpi-books",
    },
    {
      label: "Total Views",
      value: totals.totalViews.toLocaleString(),
      sub: `${totals.uniqueViews.toLocaleString()} unique views`,
      delta: comparison.views,
      icon: Eye,
      testId: "kpi-views",
    },
    {
      label: "Total Downloads",
      value: totals.totalDownloads.toLocaleString(),
      sub: "Verified book downloads",
      delta: comparison.downloads,
      icon: Download,
      testId: "kpi-downloads",
    },
    {
      label: "Total Likes",
      value: totals.totalLikes.toLocaleString(),
      sub: "Reader appreciations",
      delta: comparison.likes,
      icon: Heart,
      testId: "kpi-likes",
    },
    {
      label: "Total Comments",
      value: totals.totalComments.toLocaleString(),
      sub: "Reader discussions",
      delta: comparison.comments,
      icon: MessageCircle,
      testId: "kpi-comments",
    },
    {
      label: "Total Shares",
      value: totals.totalShares.toLocaleString(),
      sub: "External & link shares",
      delta: comparison.shares,
      icon: Share2,
      testId: "kpi-shares",
    },
    {
      label: "Total Bookmarks",
      value: totals.totalBookmarks.toLocaleString(),
      sub: "Saved to libraries",
      delta: comparison.bookmarks,
      icon: Bookmark,
      testId: "kpi-bookmarks",
    },
    {
      label: "Unique Readers",
      value: totals.uniqueReaders.toLocaleString(),
      sub: `${totals.totalReadingSessions.toLocaleString()} reading sessions`,
      icon: TrendingUp,
      testId: "kpi-readers",
    },
    {
      label: "Total Reading Time",
      value: formatReadingDuration(totals.totalReadingTimeSeconds),
      sub: `${totals.totalPagesRead.toLocaleString()} pages · avg ${formatReadingDuration(totals.avgReadingDurationSeconds)}`,
      icon: Clock,
      testId: "kpi-reading-time",
    },
  ];

  const todayVsYesterdayDiff = insights.todayViews - insights.yesterdayViews;

  return (
    <div className="space-y-6" data-testid="channel-analytics-panel">
      {/* Top Filter Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Channel Performance Overview
          </h2>
          <p className="text-xs text-muted-foreground">
            {dashboard.range.label} · Aggregated automatically across all{" "}
            <span className="tabular-nums">{lifetimeTotals.totalBooks}</span> channel books
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={preset}
            onValueChange={(val) => setPreset(val as AnalyticsTimeRangePreset)}
          >
            <SelectTrigger
              className="w-[165px] h-9"
              aria-label="Analytics time range"
            >
              <SelectValue placeholder="Time range" />
            </SelectTrigger>
            <SelectContent>
              {PRESET_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                aria-label="Start date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-9 w-[140px] text-xs"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                aria-label="End date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-9 w-[140px] text-xs"
              />
            </div>
          )}

          {compact && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => navigate(`/bookshelf/channel/${channelId}/analytics`)}
            >
              <BarChart3 className="w-4 h-4" />
              Full Studio
            </Button>
          )}
        </div>
      </div>

      {/* KPI Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          const delta = formatDeltaLabel(kpi.delta);
          return (
            <Card
              key={kpi.label}
              className="p-4 flex flex-col justify-between gap-2"
              data-testid={kpi.testId}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground truncate">
                  {kpi.label}
                </span>
                <Icon className="w-4 h-4 text-primary shrink-0" />
              </div>
              <div className="text-2xl font-bold tracking-tight tabular-nums">
                {kpi.value}
              </div>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between text-[11px] text-muted-foreground">
                <span className="truncate">{kpi.sub}</span>
                {delta && (
                  <span
                    className={`inline-flex items-center shrink-0 font-medium tabular-nums ${
                      delta.positive
                        ? "text-emerald-600 dark:text-emerald-400"
                        : delta.negative
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-muted-foreground"
                    }`}
                  >
                    {delta.positive && <ArrowUpRight className="w-3 h-3 mr-0.5" />}
                    {delta.negative && <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                    {delta.text}
                  </span>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Insights Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Today vs Yesterday</p>
          <p className="text-base font-semibold mt-1 tabular-nums">
            {insights.todayViews.toLocaleString()} views today ·{" "}
            {insights.yesterdayViews.toLocaleString()} yesterday
          </p>
          <p className="text-xs text-muted-foreground mt-1 tabular-nums">
            {todayVsYesterdayDiff >= 0
              ? `+${todayVsYesterdayDiff.toLocaleString()} more views than yesterday`
              : `${todayVsYesterdayDiff.toLocaleString()} vs yesterday`}
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Last 7 Days Downloads</p>
          <p className="text-base font-semibold mt-1 tabular-nums">
            {insights.last7DaysDownloads.toLocaleString()} downloads
          </p>
          <p className="text-xs text-muted-foreground mt-1 tabular-nums">
            Lifetime downloads across channel: {lifetimeTotals.totalDownloads.toLocaleString()}
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Top Performing Book</p>
          {insights.mostPopularBook ? (
            <>
              <p className="text-base font-semibold mt-1 truncate">
                {insights.mostPopularBook.title}
              </p>
              <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                {insights.mostPopularBook.totalViews.toLocaleString()} views ·{" "}
                {insights.mostPopularBook.totalLikes.toLocaleString()} likes
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground mt-1">No book activity yet</p>
          )}
        </Card>
      </div>

      {/* Analytics History & Growth Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">Views &amp; Downloads History</h3>
              <p className="text-xs text-muted-foreground">
                Daily reader traffic and verified downloads
              </p>
            </div>
          </div>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="viewsAreaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="downloadsAreaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "0.5rem",
                    border: "1px solid hsl(var(--border))",
                    backgroundColor: "hsl(var(--card))",
                    color: "hsl(var(--foreground))",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Area
                  type="monotone"
                  dataKey="views"
                  name="Views"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#viewsAreaFill)"
                />
                <Area
                  type="monotone"
                  dataKey="downloads"
                  name="Downloads"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#downloadsAreaFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">Engagement &amp; Subscriber Growth</h3>
              <p className="text-xs text-muted-foreground">
                Likes, comments, shares, and new channel subscribers
              </p>
            </div>
          </div>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "0.5rem",
                    border: "1px solid hsl(var(--border))",
                    backgroundColor: "hsl(var(--card))",
                    color: "hsl(var(--foreground))",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="likes" name="Likes" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="comments" name="Comments" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="shares" name="Shares" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                <Bar
                  dataKey="subscribersGained"
                  name="New Subscribers"
                  fill="#8b5cf6"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Individual Book Performance Table */}
      <Card className="overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold">
              Individual Book Performance ({filteredAndSortedBooks.length})
            </h3>
            <p className="text-xs text-muted-foreground">
              Click any book to inspect its standalone charts and period comparisons
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="w-4 h-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Filter books..."
                aria-label="Filter channel books"
                className="pl-8 h-9 text-sm"
              />
            </div>

            <Select
              value={sortBy}
              onValueChange={(val) => setSortBy(val as BookPerformanceSort)}
            >
              <SelectTrigger className="w-[180px] h-9" aria-label="Sort books by metric">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {filteredAndSortedBooks.length === 0 ? (
          <div className="p-8 text-center">
            <BookOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="font-medium text-sm">
              {searchTerm ? "No matching books found" : "No published books yet"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {searchTerm
                ? "Try clearing your search filter."
                : "Publish a book to start tracking views, downloads, likes, and reading activity."}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left font-medium py-3 px-4">Book</th>
                    <th className="text-right font-medium py-3 px-3">Views</th>
                    <th className="text-right font-medium py-3 px-3">Downloads</th>
                    <th className="text-right font-medium py-3 px-3">Likes</th>
                    <th className="text-right font-medium py-3 px-3">Comments</th>
                    <th className="text-right font-medium py-3 px-3">Shares</th>
                    <th className="text-right font-medium py-3 px-3">Bookmarks</th>
                    <th className="text-right font-medium py-3 px-3">Read Time</th>
                    <th className="text-right font-medium py-3 px-4">Analytics</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredAndSortedBooks.map((book) => (
                    <tr
                      key={book.bookId}
                      className="hover:bg-muted/30 transition-colors"
                      data-testid={`book-row-${book.bookId}`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <div className="w-9 h-12 rounded overflow-hidden bg-muted shrink-0">
                            {book.coverUrl ? (
                              <img
                                src={book.coverUrl}
                                alt={book.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-gradient-primary">
                                <BookOpen className="w-4 h-4 text-white" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => navigate(`/bookshelf/book/${book.bookId}/analytics`)}
                              className="font-medium text-left hover:text-primary transition-colors line-clamp-1"
                            >
                              {book.title}
                            </button>
                            <p className="text-xs text-muted-foreground truncate">
                              {book.author}
                              {book.publishedAt
                                ? ` · ${new Date(book.publishedAt).toLocaleDateString()}`
                                : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-medium tabular-nums">
                        {formatCompactNumber(book.totalViews)}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {formatCompactNumber(book.totalDownloads)}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {formatCompactNumber(book.totalLikes)}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {formatCompactNumber(book.totalComments)}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {formatCompactNumber(book.totalShares)}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {formatCompactNumber(book.totalBookmarks)}
                      </td>
                      <td className="py-3 px-3 text-right text-xs text-muted-foreground tabular-nums">
                        {formatReadingDuration(book.totalReadingTimeSeconds)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1"
                          onClick={() => navigate(`/bookshelf/book/${book.bookId}/analytics`)}
                        >
                          Inspect
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Book Performance List */}
            <div className="md:hidden divide-y divide-border">
              {filteredAndSortedBooks.map((book) => (
                <div key={book.bookId} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-14 rounded overflow-hidden bg-muted shrink-0">
                        {book.coverUrl ? (
                          <img
                            src={book.coverUrl}
                            alt={book.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-primary">
                            <BookOpen className="w-4 h-4 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm line-clamp-1">{book.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{book.author}</p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0"
                      onClick={() => navigate(`/bookshelf/book/${book.bookId}/analytics`)}
                    >
                      Analytics
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Views</span>
                      <p className="font-semibold tabular-nums">{book.totalViews.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Downloads</span>
                      <p className="font-semibold tabular-nums">
                        {book.totalDownloads.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Likes</span>
                      <p className="font-semibold tabular-nums">{book.totalLikes.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Comments</span>
                      <p className="font-semibold tabular-nums">
                        {book.totalComments.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Shares</span>
                      <p className="font-semibold tabular-nums">{book.totalShares.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Bookmarks</span>
                      <p className="font-semibold tabular-nums">
                        {book.totalBookmarks.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
};

export default ChannelAnalyticsPanel;
