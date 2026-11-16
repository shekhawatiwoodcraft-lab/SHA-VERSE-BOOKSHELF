import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Bookmark,
  Clock,
  Download,
  Eye,
  FileText,
  Heart,
  Lock,
  MessageCircle,
  Share2,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useBookAnalytics } from "@/hooks/useBookAnalytics";
import { formatReadingDuration } from "@/lib/analytics/aggregation";
import type { AnalyticsTimeRangePreset, PeriodDeltaMetric } from "@/lib/analytics/types";

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

function renderDelta(metric: PeriodDeltaMetric) {
  const pct = metric.changePercent ?? 0;
  const pos = metric.change > 0;
  const neg = metric.change < 0;
  return (
    <span
      className={`inline-flex items-center text-xs font-medium tabular-nums ${
        pos
          ? "text-emerald-600 dark:text-emerald-400"
          : neg
            ? "text-rose-600 dark:text-rose-400"
            : "text-muted-foreground"
      }`}
    >
      {pos && <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />}
      {neg && <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
      {pos ? "+" : ""}
      {metric.change.toLocaleString()} ({pos ? "+" : ""}
      {pct}%)
    </span>
  );
}

const tooltipStyle = {
  borderRadius: "0.5rem",
  border: "1px solid hsl(var(--border))",
  backgroundColor: "hsl(var(--card))",
  color: "hsl(var(--foreground))",
  fontSize: "12px",
};

const BookAnalytics = () => {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [preset, setPreset] = useState<AnalyticsTimeRangePreset>("all");
  const [customStart, setCustomStart] = useState<string>(() => {
    const d = new Date(Date.now() - 27 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );

  const { detail, isLoading, isError, refetch } = useBookAnalytics({
    bookId,
    preset,
    customStart: preset === "custom" ? customStart : undefined,
    customEnd: preset === "custom" ? customEnd : undefined,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 text-center">
        <BookOpen className="w-12 h-12 text-muted-foreground mb-3" />
        <h1 className="text-xl font-semibold mb-1">Unable to load book analytics</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Book analytics could not be retrieved right now.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void refetch()}>
            Retry
          </Button>
          <Button onClick={() => navigate("/bookshelf")}>Back to Bookshelf</Button>
        </div>
      </div>
    );
  }

  const { book, metrics, lifetimeMetrics, timeSeries, comparison } = detail;
  const isOwner = user?.id && book.channel?.user_id === user.id;

  const kpis = [
    { label: "Total Views", value: metrics.totalViews.toLocaleString(), sub: `${metrics.uniqueViews.toLocaleString()} unique`, icon: Eye },
    { label: "Total Downloads", value: metrics.totalDownloads.toLocaleString(), sub: "Verified downloads", icon: Download },
    { label: "Total Likes", value: metrics.totalLikes.toLocaleString(), sub: "Book likes", icon: Heart },
    { label: "Total Comments", value: metrics.totalComments.toLocaleString(), sub: "Reader comments", icon: MessageCircle },
    { label: "Total Shares", value: metrics.totalShares.toLocaleString(), sub: "External & link shares", icon: Share2 },
    { label: "Total Bookmarks", value: metrics.totalBookmarks.toLocaleString(), sub: "Saved in libraries", icon: Bookmark },
    { label: "Unique Readers", value: metrics.uniqueReaders.toLocaleString(), sub: "Distinct readers", icon: Users },
    { label: "Reading Sessions", value: metrics.totalReadingSessions.toLocaleString(), sub: "Active reader sessions", icon: BookOpen },
    { label: "Total Reading Time", value: formatReadingDuration(metrics.totalReadingTimeSeconds), sub: `Avg ${formatReadingDuration(metrics.avgReadingDurationSeconds)} / session`, icon: Clock },
    { label: "Pages Read", value: metrics.totalPagesRead.toLocaleString(), sub: `${metrics.engagementRatePercent}% engagement rate`, icon: FileText },
  ];

  const comparisons = [
    { label: "Views", data: comparison.views },
    { label: "Downloads", data: comparison.downloads },
    { label: "Likes", data: comparison.likes },
    { label: "Comments", data: comparison.comments },
    { label: "Shares", data: comparison.shares },
    { label: "Reading Sessions", data: comparison.readingSessions },
  ];

  return (
    <div className="min-h-screen bg-background pb-20" data-testid="book-analytics-page">
      <header className="sticky top-0 z-40 bg-card/85 backdrop-blur-lg border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back to book"
              onClick={() => navigate(`/bookshelf/book/${book.id}`)}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="font-semibold text-base truncate flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary shrink-0" />
                {book.title} — Analytics
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                Independent book performance metrics
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/bookshelf/book/${book.id}`)}
            >
              Book Page
            </Button>
            {book.channel?.id && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/bookshelf/channel/${book.channel.id}/analytics`)}
              >
                Channel Analytics
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {!isOwner ? (
          <Card className="p-8 text-center max-w-lg mx-auto">
            <Lock className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <h2 className="text-lg font-semibold mb-1">Creator Analytics Only</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Detailed book analytics are restricted to the channel owner.
            </p>
            <Button onClick={() => navigate(`/bookshelf/book/${book.id}`)}>
              Return to Book
            </Button>
          </Card>
        ) : (
          <>
            {/* Book Identity & Date Range Filter */}
            <Card className="p-4 sm:p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-14 h-20 rounded-md overflow-hidden bg-muted shrink-0">
                  {book.cover_url ? (
                    <img
                      src={book.cover_url}
                      alt={book.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-primary">
                      <BookOpen className="w-5 h-5 text-white" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="font-semibold text-base truncate">{book.title}</h2>
                  <p className="text-sm text-muted-foreground truncate">
                    by {book.author}
                    {book.category ? ` · ${book.category}` : ""}
                    {book.visibility ? ` · ${book.visibility}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                    Published{" "}
                    {book.created_at
                      ? new Date(book.created_at).toLocaleDateString()
                      : "Unknown"}{" "}
                    · Lifetime Views: {lifetimeMetrics.totalViews.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={preset}
                  onValueChange={(val) => setPreset(val as AnalyticsTimeRangePreset)}
                >
                  <SelectTrigger
                    className="w-[165px] h-9"
                    aria-label="Book analytics time range"
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
              </div>
            </Card>

            {/* Independent Book KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {kpis.map((item) => {
                const Icon = item.icon;
                return (
                  <Card key={item.label} className="p-4 flex flex-col justify-between gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {item.label}
                      </span>
                      <Icon className="w-4 h-4 text-primary shrink-0" />
                    </div>
                    <div className="text-2xl font-bold tracking-tight tabular-nums">
                      {item.value}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {item.sub}
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* Period Comparison */}
            <Card className="p-4 sm:p-5">
              <div className="mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Compare Across Time Periods
                </h3>
                <p className="text-xs text-muted-foreground">
                  Selected window ({preset === "all" ? "Last 28 Days" : PRESET_OPTIONS.find((o) => o.value === preset)?.label}) vs preceding equivalent period
                </p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {comparisons.map((comp) => (
                  <div
                    key={comp.label}
                    className="rounded-lg border border-border p-3 space-y-1"
                  >
                    <p className="text-xs text-muted-foreground">{comp.label}</p>
                    <p className="text-lg font-bold tabular-nums">
                      {comp.data.current.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      Prev: {comp.data.previous.toLocaleString()}
                    </p>
                    <div>{renderDelta(comp.data)}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* 5 Dedicated Per-Book Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 1. Views over time */}
              <Card className="p-4 sm:p-5">
                <h3 className="text-sm font-semibold mb-1">Views Over Time</h3>
                <p className="text-xs text-muted-foreground mb-4">Daily view activity</p>
                <div className="h-[230px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Area
                        type="monotone"
                        dataKey="views"
                        name="Views"
                        stroke="#6366f1"
                        fill="#6366f1"
                        fillOpacity={0.2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* 2. Downloads over time */}
              <Card className="p-4 sm:p-5">
                <h3 className="text-sm font-semibold mb-1">Downloads Over Time</h3>
                <p className="text-xs text-muted-foreground mb-4">Verified book downloads</p>
                <div className="h-[230px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={timeSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="downloads" name="Downloads" fill="#10b981" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* 3. Likes over time */}
              <Card className="p-4 sm:p-5">
                <h3 className="text-sm font-semibold mb-1">Likes Over Time</h3>
                <p className="text-xs text-muted-foreground mb-4">Daily reader likes</p>
                <div className="h-[230px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={timeSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="likes" name="Likes" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* 4. Comments over time */}
              <Card className="p-4 sm:p-5">
                <h3 className="text-sm font-semibold mb-1">Comments Over Time</h3>
                <p className="text-xs text-muted-foreground mb-4">Reader comments &amp; replies</p>
                <div className="h-[230px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={timeSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="comments" name="Comments" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* 5. Engagement over time */}
              <Card className="p-4 sm:p-5 lg:col-span-2">
                <h3 className="text-sm font-semibold mb-1">Reader Engagement Over Time</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Combined engagement events, shares, bookmarks, and reading minutes
                </p>
                <div className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timeSeries} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: "12px" }} />
                      <Line
                        type="monotone"
                        dataKey="engagement"
                        name="Total Engagement"
                        stroke="#8b5cf6"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="shares"
                        name="Shares"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="bookmarks"
                        name="Bookmarks"
                        stroke="#06b6d4"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="readingMinutes"
                        name="Reading Minutes"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default BookAnalytics;
