import { Card } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type { DashboardSummary } from "@/modules/bookshelf/lib/libraryWorkspace";

const STATUS_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

interface DashboardAnalyticsChartsProps {
  books: Array<{ category?: string | null }>;
  summary: DashboardSummary;
}

export function DashboardAnalyticsCharts({ books, summary }: DashboardAnalyticsChartsProps) {
  const categoryCounts = new Map<string, number>();
  for (const book of books) {
    const cat = book.category?.trim() || "Uncategorized";
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
  }
  const categoryData = Array.from(categoryCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const statusData = [
    { name: "Currently Reading", value: summary.currentlyReading },
    { name: "Completed", value: summary.completedBooks },
    { name: "Unread", value: summary.unreadBooks },
    { name: "Abandoned", value: summary.abandonedBooks },
  ].filter((d) => d.value > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4 sm:p-5">
        <h3 className="text-sm font-semibold mb-1">Books by Category</h3>
        <p className="text-xs text-muted-foreground mb-4">Top categories across your catalog</p>
        {categoryData.length > 0 ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData} margin={{ top: 8, right: 8, left: -16, bottom: 24 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
            Add books to see category distribution.
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <h3 className="text-sm font-semibold mb-1">Reading Status Breakdown</h3>
        <p className="text-xs text-muted-foreground mb-4">Distribution across reading stages</p>
        {statusData.length > 0 ? (
          <div className="h-64 w-full flex flex-col sm:flex-row items-center gap-4">
            <div className="h-48 w-full sm:w-1/2 min-w-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={42}
                    outerRadius={72}
                    paddingAngle={3}
                    isAnimationActive={false}
                  >
                    {statusData.map((_, idx) => (
                      <Cell key={idx} fill={STATUS_COLORS[idx % STATUS_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2 w-full">
              {statusData.map((item, idx) => (
                <div key={item.name} className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: STATUS_COLORS[idx % STATUS_COLORS.length] }}
                    />
                    {item.name}
                  </span>
                  <span className="font-semibold">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
            Start reading books to track completion analytics.
          </div>
        )}
      </Card>
    </div>
  );
}
