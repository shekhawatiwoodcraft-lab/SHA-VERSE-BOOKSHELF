export type ReadingStatus =
  | "want_to_read"
  | "currently_reading"
  | "completed"
  | "on_hold"
  | "abandoned";

export type BookFormat =
  | "ebook"
  | "pdf"
  | "epub"
  | "audiobook"
  | "physical"
  | "paperback"
  | "hardcover"
  | "other";

export type GoalType = "books" | "pages" | "minutes";
export type GoalPeriod = "daily" | "weekly" | "monthly" | "yearly" | "custom";
export type LoanType = "borrowed" | "lent";
export type LoanStatus = "active" | "returned" | "overdue";

export interface ReadingProgressRecord {
  book_id: string;
  current_page: number | null;
  total_pages: number | null;
  completed?: boolean | null;
  reading_status?: ReadingStatus | string | null;
  reading_seconds?: number | null;
  last_read_at?: string | null;
  completed_at?: string | null;
  book?: {
    id: string;
    title: string;
    author: string;
    category?: string | null;
    pages?: number | null;
  } | null;
}

export interface ReadingGoalRecord {
  id: string;
  title: string;
  goal_type: GoalType;
  period: GoalPeriod;
  target_value: number;
  start_date: string;
  end_date: string;
  is_completed?: boolean;
}

export interface BookLoanRecord {
  id: string;
  book_title: string;
  author_name?: string | null;
  loan_type: LoanType;
  counterparty_name: string;
  loan_date: string;
  expected_return_date?: string | null;
  actual_return_date?: string | null;
  status: LoanStatus;
}

/**
 * Pure reading progress validation & percentage calculation.
 * Rejects negative pages, clamps/flags values exceeding totalPages, and keeps
 * completed status synchronized with percentage.
 */
export function computeValidatedReadingProgress(input: {
  currentPage: number;
  totalPages: number | null | undefined;
  requestedStatus?: ReadingStatus;
}): {
  valid: boolean;
  error?: string;
  currentPage: number;
  totalPages: number | null;
  percent: number;
  completed: boolean;
  readingStatus: ReadingStatus;
} {
  if (!Number.isFinite(input.currentPage) || input.currentPage < 0) {
    return {
      valid: false,
      error: "Current page cannot be negative.",
      currentPage: 0,
      totalPages: input.totalPages ?? null,
      percent: 0,
      completed: false,
      readingStatus: input.requestedStatus ?? "currently_reading",
    };
  }

  const total =
    input.totalPages && Number.isFinite(input.totalPages) && input.totalPages > 0
      ? Math.floor(input.totalPages)
      : null;
  const page = Math.floor(input.currentPage);

  if (total !== null && page > total) {
    return {
      valid: false,
      error: `Current page (${page}) cannot exceed total pages (${total}).`,
      currentPage: total,
      totalPages: total,
      percent: 100,
      completed: true,
      readingStatus: input.requestedStatus ?? "completed",
    };
  }

  const percent =
    input.requestedStatus === "completed"
      ? 100
      : total !== null
        ? Math.min(100, Math.max(0, Math.round((page / total) * 100)))
        : 0;

  const isCompleted =
    input.requestedStatus === "completed" || (total !== null && page >= total && page > 0);
  const readingStatus: ReadingStatus = isCompleted
    ? "completed"
    : input.requestedStatus ?? (page > 0 ? "currently_reading" : "want_to_read");

  return {
    valid: true,
    currentPage: isCompleted && total !== null ? total : page,
    totalPages: total,
    percent,
    completed: isCompleted,
    readingStatus,
  };
}

export function resolveEffectiveLoanStatus(
  loan: Pick<BookLoanRecord, "status" | "expected_return_date" | "actual_return_date">,
  todayIso = new Date().toISOString().slice(0, 10),
): LoanStatus {
  if (loan.status === "returned" || loan.actual_return_date) {
    return "returned";
  }
  if (loan.expected_return_date && loan.expected_return_date < todayIso) {
    return "overdue";
  }
  return "active";
}

export function computeGoalProgress(
  goal: ReadingGoalRecord,
  progressRows: ReadingProgressRecord[],
): {
  currentValue: number;
  targetValue: number;
  percent: number;
  achieved: boolean;
} {
  const start = goal.start_date;
  const end = goal.end_date;

  const inWindow = progressRows.filter((row) => {
    const refDate = (row.completed_at || row.last_read_at || "").slice(0, 10);
    if (!refDate) return true;
    return refDate >= start && refDate <= end;
  });

  let currentValue = 0;
  if (goal.goal_type === "books") {
    const uniqueCompletedBookIds = new Set(
      inWindow
        .filter((r) => r.completed || r.reading_status === "completed")
        .map((r) => r.book_id),
    );
    currentValue = uniqueCompletedBookIds.size;
  } else if (goal.goal_type === "pages") {
    const seenBooks = new Map<string, number>();
    for (const r of inWindow) {
      const prev = seenBooks.get(r.book_id) ?? 0;
      const pages = Math.max(0, r.current_page ?? 0);
      if (pages > prev) seenBooks.set(r.book_id, pages);
    }
    for (const val of seenBooks.values()) currentValue += val;
  } else {
    let totalSec = 0;
    const seenBooks = new Set<string>();
    for (const r of inWindow) {
      if (seenBooks.has(r.book_id)) continue;
      seenBooks.add(r.book_id);
      totalSec += Math.max(0, r.reading_seconds ?? 0);
    }
    currentValue = Math.round(totalSec / 60);
  }

  const targetValue = Math.max(1, goal.target_value);
  const percent = Math.min(100, Math.round((currentValue / targetValue) * 100));
  return {
    currentValue,
    targetValue,
    percent,
    achieved: currentValue >= targetValue,
  };
}

export interface DashboardSummary {
  totalBooks: number;
  totalShelves: number;
  totalAuthors: number;
  totalCategories: number;
  currentlyReading: number;
  completedBooks: number;
  unreadBooks: number;
  abandonedBooks: number;
  totalPagesRead: number;
  totalReadingHours: number;
}

export function computeDashboardSummary(params: {
  books: Array<{ id: string; author: string; category?: string | null }>;
  shelvesCount: number;
  progressRows: ReadingProgressRecord[];
}): DashboardSummary {
  const uniqueAuthors = new Set<string>();
  const uniqueCategories = new Set<string>();
  for (const b of params.books) {
    if (b.author?.trim()) uniqueAuthors.add(b.author.trim().toLowerCase());
    if (b.category?.trim()) uniqueCategories.add(b.category.trim().toLowerCase());
  }

  // Deduplicate progress per unique book_id to prevent double-counting
  const progressByBook = new Map<string, ReadingProgressRecord>();
  for (const row of params.progressRows) {
    if (!progressByBook.has(row.book_id)) {
      progressByBook.set(row.book_id, row);
    }
  }

  let currentlyReading = 0;
  let completedBooks = 0;
  let abandonedBooks = 0;
  let wantToRead = 0;
  let totalPagesRead = 0;
  let totalReadingSeconds = 0;

  for (const row of progressByBook.values()) {
    const status: ReadingStatus = row.completed
      ? "completed"
      : (row.reading_status as ReadingStatus) || "currently_reading";
    if (status === "completed") completedBooks += 1;
    else if (status === "abandoned") abandonedBooks += 1;
    else if (status === "want_to_read") wantToRead += 1;
    else currentlyReading += 1;

    totalPagesRead += Math.max(0, row.current_page ?? 0);
    totalReadingSeconds += Math.max(0, row.reading_seconds ?? 0);
  }

  const trackedCount = currentlyReading + completedBooks + abandonedBooks;
  const unreadBooks = Math.max(wantToRead, Math.max(0, params.books.length - trackedCount));

  return {
    totalBooks: params.books.length,
    totalShelves: params.shelvesCount,
    totalAuthors: uniqueAuthors.size,
    totalCategories: uniqueCategories.size,
    currentlyReading,
    completedBooks,
    unreadBooks,
    abandonedBooks,
    totalPagesRead,
    totalReadingHours: Number((totalReadingSeconds / 3600).toFixed(1)),
  };
}

export interface ExportableBook {
  title: string;
  author: string;
  category?: string | null;
  language?: string | null;
  pages?: number | null;
  description?: string | null;
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function serializeBooksToCsv(books: ExportableBook[]): string {
  const headers = ["title", "author", "category", "language", "pages", "description"];
  const lines = [headers.join(",")];
  for (const b of books) {
    lines.push(
      [
        escapeCsvCell(b.title || ""),
        escapeCsvCell(b.author || ""),
        escapeCsvCell(b.category || ""),
        escapeCsvCell(b.language || "English"),
        escapeCsvCell(b.pages ? String(b.pages) : ""),
        escapeCsvCell((b.description || "").replace(/\r?\n/g, " ")),
      ].join(","),
    );
  }
  return lines.join("\n");
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export interface ValidatedImportRow {
  rowNumber: number;
  title: string;
  author: string;
  category: string;
  language: string;
  pages?: number;
  description?: string;
  status: "ready" | "duplicate" | "invalid";
  error?: string;
}

export function parseAndValidateBookImport(
  rawText: string,
  format: "csv" | "json",
  existingBooks: Array<{ title: string; author: string }>,
): ValidatedImportRow[] {
  const existingKeys = new Set(
    existingBooks.map((b) => `${b.title.trim().toLowerCase()}::${b.author.trim().toLowerCase()}`),
  );
  const seenImportKeys = new Set<string>();
  const rawRows: Array<Record<string, unknown>> = [];

  if (format === "json") {
    const parsed = JSON.parse(rawText);
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.books) ? parsed.books : [];
    for (const item of arr) {
      if (item && typeof item === "object") rawRows.push(item as Record<string, unknown>);
    }
  } else {
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const obj: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        obj[h] = cells[idx] ?? "";
      });
      rawRows.push(obj);
    }
  }

  return rawRows.slice(0, 200).map((row, idx) => {
    const title = String(row.title ?? "").trim();
    const author = String(row.author ?? "").trim();
    const category = String(row.category ?? "Fiction").trim() || "Fiction";
    const language = String(row.language ?? "English").trim() || "English";
    const description = String(row.description ?? "").trim() || undefined;
    const rawPages = row.pages !== undefined && row.pages !== "" ? Number(row.pages) : undefined;
    const pages = rawPages && Number.isFinite(rawPages) && rawPages > 0 ? Math.floor(rawPages) : undefined;

    if (!title || !author) {
      return {
        rowNumber: idx + 1,
        title,
        author,
        category,
        language,
        pages,
        description,
        status: "invalid",
        error: "Both Title and Author are required.",
      };
    }

    const key = `${title.toLowerCase()}::${author.toLowerCase()}`;
    if (existingKeys.has(key) || seenImportKeys.has(key)) {
      return {
        rowNumber: idx + 1,
        title,
        author,
        category,
        language,
        pages,
        description,
        status: "duplicate",
        error: "Already exists in library or duplicated in import file.",
      };
    }

    seenImportKeys.add(key);
    return {
      rowNumber: idx + 1,
      title,
      author,
      category,
      language,
      pages,
      description,
      status: "ready",
    };
  });
}
