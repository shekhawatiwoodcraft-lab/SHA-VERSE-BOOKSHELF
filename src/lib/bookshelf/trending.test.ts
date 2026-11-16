import { describe, it, expect } from "vitest";
import {
  getCurrentWeekWindow,
  sortDiscoverBooks,
  rankTrendingBooks,
  formatWeekRangeLabel,
  computeReadingProgressStats,
  filterReadingHistory,
  type ReadingHistoryEntry,
} from "./trending";

describe("bookshelf trending & discover ordering", () => {
  it("computes consistent ISO week window and rollover duration", () => {
    const wednesday = new Date("2026-11-11T12:00:00Z");
    const win = getCurrentWeekWindow(wednesday);
    expect(win.weekKey).toBe("2026-W46");
    expect(win.weekStartIso).toBe("2026-11-09T00:00:00.000Z");
    expect(win.weekEndIso).toBe("2026-11-16T00:00:00.000Z");
    expect(win.msUntilNextWeek).toBeGreaterThan(0);

    const nextMonday = new Date("2026-11-16T01:00:00Z");
    const nextWin = getCurrentWeekWindow(nextMonday);
    expect(nextWin.weekKey).toBe("2026-W47");
  });

  it("formats inclusive weekly display range accurately", () => {
    expect(
      formatWeekRangeLabel("2026-11-09T00:00:00.000Z", "2026-11-16T00:00:00.000Z"),
    ).toBe("Nov 9 – Nov 15");
    expect(formatWeekRangeLabel("invalid", "invalid")).toBe("This Week");
  });

  it("sorts Discover books with most recently launched first", () => {
    const books = [
      { id: "b1", created_at: "2026-01-01T00:00:00Z" },
      { id: "b3", created_at: "2026-03-01T00:00:00Z" },
      { id: "b2", created_at: "2026-02-01T00:00:00Z" },
    ];
    expect(sortDiscoverBooks(books).map((b) => b.id)).toEqual(["b3", "b2", "b1"]);
  });

  it("ranks Trending books with highest views and likes first", () => {
    const books = [
      { id: "low", views_count: 5, likes_count: 1, created_at: "2026-11-10T00:00:00Z" },
      { id: "top", views_count: 120, likes_count: 45, created_at: "2026-11-01T00:00:00Z" },
      { id: "mid", views_count: 80, likes_count: 20, created_at: "2026-11-05T00:00:00Z" },
    ];
    expect(rankTrendingBooks(books).map((b) => b.id)).toEqual(["top", "mid", "low"]);
  });

  it("prioritizes weekly surge when weekly events are present", () => {
    const books = [
      { id: "old-giant", views_count: 50, likes_count: 10 },
      { id: "weekly-hot", views_count: 40, likes_count: 25 },
    ];
    const ranked = rankTrendingBooks(books, {
      "old-giant": { views: 0, likes: 0, downloads: 0, comments: 0, shares: 0 },
      "weekly-hot": { views: 30, likes: 20, downloads: 5, comments: 3, shares: 2 },
    });
    expect(ranked[0].id).toBe("weekly-hot");
  });

  it("computes reading progress stats and filters library history accurately", () => {
    const entries: ReadingHistoryEntry[] = [
      {
        id: "h1",
        current_page: 50,
        total_pages: 136,
        completed: false,
        book: { id: "b1", title: "Two Boy Gold Miners", author: "Frank Webster", category: "Fiction" },
      },
      {
        id: "h2",
        current_page: 100,
        total_pages: 100,
        completed: true,
        book: { id: "b2", title: "Clean Physics", author: "A. Scientist", category: "Science" },
      },
      {
        id: "h3",
        current_page: 0,
        total_pages: 200,
        completed: false,
        book: { id: "b3", title: "History Notes", author: "H. Writer", category: "Education" },
      },
      {
        id: "h4",
        current_page: 10,
        total_pages: 50,
        book: null,
      },
    ];

    expect(computeReadingProgressStats(entries[0])).toEqual({
      currentPage: 50,
      totalPages: 136,
      percent: 37,
      isFinished: false,
    });
    expect(computeReadingProgressStats(entries[1])).toEqual({
      currentPage: 100,
      totalPages: 100,
      percent: 100,
      isFinished: true,
    });
    expect(computeReadingProgressStats(entries[2])).toEqual({
      currentPage: 1,
      totalPages: 200,
      percent: 0,
      isFinished: false,
    });

    expect(filterReadingHistory(entries, { filter: "all" }).map((e) => e.id)).toEqual(["h1", "h2", "h3"]);
    expect(filterReadingHistory(entries, { filter: "in_progress" }).map((e) => e.id)).toEqual(["h1", "h3"]);
    expect(filterReadingHistory(entries, { filter: "finished" }).map((e) => e.id)).toEqual(["h2"]);
    expect(filterReadingHistory(entries, { filter: "all", category: "Fiction" }).map((e) => e.id)).toEqual(["h1"]);
    expect(filterReadingHistory(entries, { filter: "all", search: "scientist" }).map((e) => e.id)).toEqual(["h2"]);
  });
});
