import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isSchemaMissingError } from "@/integrations/supabase/config";
import {
  computeValidatedReadingProgress,
  type GoalPeriod,
  type GoalType,
  type LoanType,
  type ReadingProgressRecord,
  type ReadingStatus,
} from "@/modules/bookshelf/lib/libraryWorkspace";

export interface ShelfRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string;
  cover_url: string | null;
  visibility: "private" | "public";
  is_default: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShelfBookRow {
  id: string;
  shelf_id: string;
  book_id: string;
  user_id: string;
  position: number;
  added_at: string;
}

export interface WorkspaceBookItem {
  id: string;
  channel_id: string;
  title: string;
  author: string;
  category: string | null;
  language: string | null;
  pages: number | null;
  cover_url: string | null;
  description: string | null;
  visibility: string | null;
  created_at: string | null;
}

export interface BookNoteRow {
  id: string;
  user_id: string;
  book_id: string;
  note_type: "note" | "highlight";
  title: string | null;
  content: string;
  page_number: number | null;
  chapter: string | null;
  highlight_color: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookLoanRow {
  id: string;
  user_id: string;
  book_id: string | null;
  book_title: string;
  author_name: string | null;
  loan_type: LoanType;
  counterparty_name: string;
  counterparty_contact: string | null;
  loan_date: string;
  expected_return_date: string | null;
  actual_return_date: string | null;
  status: "active" | "returned" | "overdue";
  notes: string | null;
  created_at: string;
}

export interface ReadingGoalRow {
  id: string;
  user_id: string;
  title: string;
  goal_type: GoalType;
  period: GoalPeriod;
  target_value: number;
  start_date: string;
  end_date: string;
  is_completed: boolean;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  title: string;
  message: string;
  category: "goal" | "loan" | "reading" | "account" | "system";
  is_read: boolean;
  action_url: string | null;
  created_at: string;
}

export interface UserSessionRow {
  id: string;
  user_id: string;
  session_token: string | null;
  browser: string | null;
  os: string | null;
  device_info: string | null;
  is_current: boolean | null;
  last_active: string | null;
  created_at: string | null;
}

async function recordAuditEvent(
  actorId: string,
  action: string,
  targetType: string,
  targetId?: string,
  metadata?: Record<string, unknown>,
) {
  try {
    await supabase.from("audit_logs" as never).insert({
      actor_id: actorId,
      action,
      target_type: targetType,
      target_id: targetId ?? null,
      metadata: metadata ?? {},
    } as never);
  } catch {
    // Non-blocking audit logging if migration isn't applied yet
  }
}

export function useLibraryWorkspace() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const booksQuery = useQuery({
    queryKey: ["workspace-books", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("books")
        .select("id, channel_id, title, author, category, language, pages, cover_url, description, visibility, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        if (isSchemaMissingError(error)) return { rows: [] as WorkspaceBookItem[], schemaMissing: true };
        throw error;
      }
      return { rows: (data || []) as WorkspaceBookItem[], schemaMissing: false };
    },
  });

  const shelvesQuery = useQuery({
    queryKey: ["workspace-shelves", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shelves" as never)
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      if (error) {
        if (isSchemaMissingError(error)) return { rows: [] as ShelfRow[], schemaMissing: true };
        throw error;
      }
      return { rows: (data || []) as ShelfRow[], schemaMissing: false };
    },
  });

  const shelfBooksQuery = useQuery({
    queryKey: ["workspace-shelf-books", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shelf_books" as never)
        .select("*")
        .eq("user_id", userId!)
        .order("added_at", { ascending: false });
      if (error) {
        if (isSchemaMissingError(error)) return { rows: [] as ShelfBookRow[], schemaMissing: true };
        throw error;
      }
      return { rows: (data || []) as ShelfBookRow[], schemaMissing: false };
    },
  });

  const progressQuery = useQuery({
    queryKey: ["workspace-reading-progress", userId],
    enabled: !!userId,
    queryFn: async () => {
      const extended = await supabase
        .from("book_reading_progress")
        .select(
          "book_id, current_page, total_pages, completed, reading_status, reading_seconds, last_read_at, completed_at, book:books(id, title, author, category, pages)",
        )
        .eq("user_id", userId!)
        .order("last_read_at", { ascending: false });

      if (!extended.error) {
        return { rows: (extended.data || []) as unknown as ReadingProgressRecord[], schemaMissing: false };
      }

      // Backward compatibility before extended columns are added via SQL migration
      if (isSchemaMissingError(extended.error)) {
        const legacy = await supabase
          .from("book_reading_progress")
          .select("book_id, current_page, total_pages, completed, last_read_at, book:books(id, title, author, category, pages)")
          .eq("user_id", userId!)
          .order("last_read_at", { ascending: false });
        if (legacy.error) {
          if (isSchemaMissingError(legacy.error)) return { rows: [] as ReadingProgressRecord[], schemaMissing: true };
          throw legacy.error;
        }
        return { rows: (legacy.data || []) as unknown as ReadingProgressRecord[], schemaMissing: true };
      }
      throw extended.error;
    },
  });

  const goalsQuery = useQuery({
    queryKey: ["workspace-goals", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reading_goals" as never)
        .select("*")
        .eq("user_id", userId!)
        .order("end_date", { ascending: true });
      if (error) {
        if (isSchemaMissingError(error)) return { rows: [] as ReadingGoalRow[], schemaMissing: true };
        throw error;
      }
      return { rows: (data || []) as ReadingGoalRow[], schemaMissing: false };
    },
  });

  const notesQuery = useQuery({
    queryKey: ["workspace-notes", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("book_notes" as never)
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      if (error) {
        if (isSchemaMissingError(error)) return { rows: [] as BookNoteRow[], schemaMissing: true };
        throw error;
      }
      return { rows: (data || []) as BookNoteRow[], schemaMissing: false };
    },
  });

  const loansQuery = useQuery({
    queryKey: ["workspace-loans", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("book_loans" as never)
        .select("*")
        .eq("user_id", userId!)
        .order("loan_date", { ascending: false });
      if (error) {
        if (isSchemaMissingError(error)) return { rows: [] as BookLoanRow[], schemaMissing: true };
        throw error;
      }
      return { rows: (data || []) as BookLoanRow[], schemaMissing: false };
    },
  });

  const notificationsQuery = useQuery({
    queryKey: ["workspace-notifications", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications" as never)
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        if (isSchemaMissingError(error)) return { rows: [] as NotificationRow[], schemaMissing: true };
        throw error;
      }
      return { rows: (data || []) as NotificationRow[], schemaMissing: false };
    },
  });

  const createShelf = useMutation({
    mutationFn: async (input: { name: string; description?: string; color?: string; visibility?: "private" | "public" }) => {
      if (!userId) throw new Error("Not authenticated");
      const trimmed = input.name.trim();
      if (!trimmed) throw new Error("Shelf name is required.");
      const { data, error } = await supabase
        .from("shelves" as never)
        .insert({
          user_id: userId,
          name: trimmed,
          description: input.description?.trim() || null,
          color: input.color || "#3b82f6",
          visibility: input.visibility || "private",
        } as never)
        .select("*")
        .single();
      if (error) throw error;
      await recordAuditEvent(userId, "create_shelf", "shelf", (data as ShelfRow).id, { name: trimmed });
      return data as ShelfRow;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-shelves", userId] });
    },
  });

  const toggleShelfArchived = useMutation({
    mutationFn: async ({ shelfId, isArchived }: { shelfId: string; isArchived: boolean }) => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("shelves" as never)
        .update({ is_archived: isArchived } as never)
        .eq("id", shelfId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-shelves", userId] });
    },
  });

  const deleteShelf = useMutation({
    mutationFn: async (shelfId: string) => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("shelves" as never)
        .delete()
        .eq("id", shelfId)
        .eq("user_id", userId);
      if (error) throw error;
      await recordAuditEvent(userId, "delete_shelf", "shelf", shelfId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-shelves", userId] });
      void queryClient.invalidateQueries({ queryKey: ["workspace-shelf-books", userId] });
    },
  });

  const assignBookToShelf = useMutation({
    mutationFn: async ({ shelfId, bookId }: { shelfId: string; bookId: string }) => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("shelf_books" as never)
        .upsert(
          { shelf_id: shelfId, book_id: bookId, user_id: userId } as never,
          { onConflict: "shelf_id,book_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-shelf-books", userId] });
    },
  });

  const removeBookFromShelf = useMutation({
    mutationFn: async ({ shelfId, bookId }: { shelfId: string; bookId: string }) => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("shelf_books" as never)
        .delete()
        .eq("shelf_id", shelfId)
        .eq("book_id", bookId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-shelf-books", userId] });
    },
  });

  const updateReadingProgress = useMutation({
    mutationFn: async (input: {
      bookId: string;
      currentPage: number;
      totalPages?: number | null;
      readingStatus?: ReadingStatus;
    }) => {
      if (!userId) throw new Error("Not authenticated");
      const validated = computeValidatedReadingProgress({
        currentPage: input.currentPage,
        totalPages: input.totalPages,
        requestedStatus: input.readingStatus,
      });
      if (!validated.valid) {
        throw new Error(validated.error || "Invalid reading progress.");
      }

      const payload: Record<string, unknown> = {
        user_id: userId,
        book_id: input.bookId,
        current_page: validated.currentPage,
        total_pages: validated.totalPages,
        completed: validated.completed,
        reading_status: validated.readingStatus,
        last_read_at: new Date().toISOString(),
        completed_at: validated.completed ? new Date().toISOString() : null,
      };

      const { error } = await supabase
        .from("book_reading_progress")
        .upsert(payload as never, { onConflict: "user_id,book_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-reading-progress", userId] });
      void queryClient.invalidateQueries({ queryKey: ["reading-history", userId] });
    },
  });

  const createGoal = useMutation({
    mutationFn: async (input: {
      title: string;
      goalType: GoalType;
      period: GoalPeriod;
      targetValue: number;
      startDate: string;
      endDate: string;
    }) => {
      if (!userId) throw new Error("Not authenticated");
      if (!input.title.trim()) throw new Error("Goal title is required.");
      if (input.targetValue < 1) throw new Error("Target value must be at least 1.");
      const { error } = await supabase.from("reading_goals" as never).insert({
        user_id: userId,
        title: input.title.trim(),
        goal_type: input.goalType,
        period: input.period,
        target_value: Math.floor(input.targetValue),
        start_date: input.startDate,
        end_date: input.endDate,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-goals", userId] });
    },
  });

  const deleteGoal = useMutation({
    mutationFn: async (goalId: string) => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("reading_goals" as never)
        .delete()
        .eq("id", goalId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-goals", userId] });
    },
  });

  const createNote = useMutation({
    mutationFn: async (input: {
      bookId: string;
      noteType: "note" | "highlight";
      title?: string;
      content: string;
      pageNumber?: number | null;
      chapter?: string;
      highlightColor?: string;
    }) => {
      if (!userId) throw new Error("Not authenticated");
      if (!input.content.trim()) throw new Error("Note content is required.");
      const { error } = await supabase.from("book_notes" as never).insert({
        user_id: userId,
        book_id: input.bookId,
        note_type: input.noteType,
        title: input.title?.trim() || null,
        content: input.content.trim(),
        page_number: input.pageNumber ?? null,
        chapter: input.chapter?.trim() || null,
        highlight_color: input.highlightColor || "#fde047",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-notes", userId] });
    },
  });

  const deleteNote = useMutation({
    mutationFn: async (noteId: string) => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("book_notes" as never)
        .delete()
        .eq("id", noteId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-notes", userId] });
    },
  });

  const createLoan = useMutation({
    mutationFn: async (input: {
      bookTitle: string;
      authorName?: string;
      loanType: LoanType;
      counterpartyName: string;
      counterpartyContact?: string;
      loanDate: string;
      expectedReturnDate?: string;
      notes?: string;
    }) => {
      if (!userId) throw new Error("Not authenticated");
      if (!input.bookTitle.trim() || !input.counterpartyName.trim()) {
        throw new Error("Book title and person name are required.");
      }
      const { error } = await supabase.from("book_loans" as never).insert({
        user_id: userId,
        book_title: input.bookTitle.trim(),
        author_name: input.authorName?.trim() || null,
        loan_type: input.loanType,
        counterparty_name: input.counterpartyName.trim(),
        counterparty_contact: input.counterpartyContact?.trim() || null,
        loan_date: input.loanDate,
        expected_return_date: input.expectedReturnDate || null,
        status: "active",
        notes: input.notes?.trim() || null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-loans", userId] });
    },
  });

  const markLoanReturned = useMutation({
    mutationFn: async (loanId: string) => {
      if (!userId) throw new Error("Not authenticated");
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase
        .from("book_loans" as never)
        .update({ status: "returned", actual_return_date: today } as never)
        .eq("id", loanId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-loans", userId] });
    },
  });

  const deleteLoan = useMutation({
    mutationFn: async (loanId: string) => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("book_loans" as never)
        .delete()
        .eq("id", loanId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-loans", userId] });
    },
  });

  const markNotificationRead = useMutation({
    mutationFn: async (id: string) => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("notifications" as never)
        .update({ is_read: true } as never)
        .eq("id", id)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-notifications", userId] });
    },
  });

  const markAllNotificationsRead = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("notifications" as never)
        .update({ is_read: true } as never)
        .eq("user_id", userId)
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace-notifications", userId] });
    },
  });

  const schemaMissing = Boolean(
    shelvesQuery.data?.schemaMissing ||
      shelfBooksQuery.data?.schemaMissing ||
      progressQuery.data?.schemaMissing ||
      goalsQuery.data?.schemaMissing ||
      notesQuery.data?.schemaMissing ||
      loansQuery.data?.schemaMissing ||
      notificationsQuery.data?.schemaMissing,
  );

  return {
    books: booksQuery.data?.rows ?? [],
    shelves: shelvesQuery.data?.rows ?? [],
    shelfBooks: shelfBooksQuery.data?.rows ?? [],
    progressRows: progressQuery.data?.rows ?? [],
    goals: goalsQuery.data?.rows ?? [],
    notes: notesQuery.data?.rows ?? [],
    loans: loansQuery.data?.rows ?? [],
    notifications: notificationsQuery.data?.rows ?? [],
    schemaMissing,
    isLoading:
      booksQuery.isLoading ||
      shelvesQuery.isLoading ||
      progressQuery.isLoading ||
      goalsQuery.isLoading ||
      notesQuery.isLoading ||
      loansQuery.isLoading,
    createShelf,
    toggleShelfArchived,
    deleteShelf,
    assignBookToShelf,
    removeBookFromShelf,
    updateReadingProgress,
    createGoal,
    deleteGoal,
    createNote,
    deleteNote,
    createLoan,
    markLoanReturned,
    deleteLoan,
    markNotificationRead,
    markAllNotificationsRead,
  };
}
