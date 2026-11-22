import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDashboardSummary,
  computeGoalProgress,
  computeValidatedReadingProgress,
  parseAndValidateBookImport,
  resolveEffectiveLoanStatus,
  serializeBooksToCsv,
} from "./libraryWorkspace";

test("computeValidatedReadingProgress validates bounds and calculates percentage accurately", () => {
  const ok = computeValidatedReadingProgress({ currentPage: 120, totalPages: 300 });
  assert.equal(ok.valid, true);
  assert.equal(ok.percent, 40);
  assert.equal(ok.completed, false);
  assert.equal(ok.readingStatus, "currently_reading");

  const done = computeValidatedReadingProgress({ currentPage: 300, totalPages: 300 });
  assert.equal(done.valid, true);
  assert.equal(done.percent, 100);
  assert.equal(done.completed, true);
  assert.equal(done.readingStatus, "completed");

  const neg = computeValidatedReadingProgress({ currentPage: -5, totalPages: 300 });
  assert.equal(neg.valid, false);

  const over = computeValidatedReadingProgress({ currentPage: 350, totalPages: 300 });
  assert.equal(over.valid, false);
});

test("resolveEffectiveLoanStatus detects overdue active loans accurately", () => {
  assert.equal(
    resolveEffectiveLoanStatus(
      { status: "active", expected_return_date: "2026-11-01", actual_return_date: null },
      "2026-11-20",
    ),
    "overdue",
  );
  assert.equal(
    resolveEffectiveLoanStatus(
      { status: "active", expected_return_date: "2026-12-01", actual_return_date: null },
      "2026-11-20",
    ),
    "active",
  );
  assert.equal(
    resolveEffectiveLoanStatus(
      { status: "active", expected_return_date: "2026-11-01", actual_return_date: "2026-11-05" },
      "2026-11-20",
    ),
    "returned",
  );
});

test("computeGoalProgress and computeDashboardSummary deduplicate books and compute metrics accurately", () => {
  const progress = [
    { book_id: "b1", current_page: 200, total_pages: 200, completed: true, reading_seconds: 3600, completed_at: "2026-11-10T10:00:00Z" },
    { book_id: "b1", current_page: 200, total_pages: 200, completed: true, reading_seconds: 3600, completed_at: "2026-11-10T10:00:00Z" },
    { book_id: "b2", current_page: 50, total_pages: 250, completed: false, reading_seconds: 1800, last_read_at: "2026-11-15T10:00:00Z" },
  ];

  const goal = computeGoalProgress(
    { id: "g1", title: "Read 2 books", goal_type: "books", period: "monthly", target_value: 2, start_date: "2026-11-01", end_date: "2026-11-30" },
    progress,
  );
  assert.equal(goal.currentValue, 1);
  assert.equal(goal.percent, 50);
  assert.equal(goal.achieved, false);

  const summary = computeDashboardSummary({
    books: [
      { id: "b1", author: "Author A", category: "Fiction" },
      { id: "b2", author: "Author B", category: "Science" },
      { id: "b3", author: "Author A", category: "Fiction" },
    ],
    shelvesCount: 4,
    progressRows: progress,
  });
  assert.equal(summary.totalBooks, 3);
  assert.equal(summary.totalShelves, 4);
  assert.equal(summary.totalAuthors, 2);
  assert.equal(summary.totalCategories, 2);
  assert.equal(summary.completedBooks, 1);
  assert.equal(summary.currentlyReading, 1);
  assert.equal(summary.unreadBooks, 1);
  assert.equal(summary.totalPagesRead, 250);
  assert.equal(summary.totalReadingHours, 1.5);
});

test("serializeBooksToCsv and parseAndValidateBookImport handle quoting, validation, and duplicates", () => {
  const csv = serializeBooksToCsv([
    { title: "Clean Architecture, Vol. 1", author: "Robert Martin", category: "Technology", language: "English", pages: 432, description: "Software design" },
  ]);
  assert.match(csv, /"Clean Architecture, Vol\. 1"/);

  const parsed = parseAndValidateBookImport(
    `${csv}\n"Existing Book","Jane Doe",Fiction,English,200,\n"","Missing Title",Fiction,English,100,`,
    "csv",
    [{ title: "Existing Book", author: "Jane Doe" }],
  );
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].status, "ready");
  assert.equal(parsed[1].status, "duplicate");
  assert.equal(parsed[2].status, "invalid");
});
