import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { SEO } from "@/components/seo/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  CheckCircle2,
  Clock,
  FolderPlus,
  Library,
  Loader2,
  Bell,
  StickyNote,
  Target,
  Trash2,
  Archive,
  Users,
  Layers,
  ArrowLeftRight,
  AlertTriangle,
  Settings as SettingsIcon,
  Shield,
  Plus,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useChannels } from "@/hooks/useChannels";
import { useAppOwner } from "@/hooks/useAppOwner";
import { useLibraryWorkspace, type WorkspaceBookItem } from "@/hooks/useLibraryWorkspace";
import {
  computeDashboardSummary,
  computeGoalProgress,
  resolveEffectiveLoanStatus,
  type GoalPeriod,
  type GoalType,
  type LoanType,
  type ReadingStatus,
} from "@/modules/bookshelf/lib/libraryWorkspace";
import { DashboardAnalyticsCharts } from "@/components/bookshelf/workspace/DashboardAnalyticsCharts";
import { ImportExportTab } from "@/components/bookshelf/workspace/ImportExportTab";

const STATUS_LABELS: Record<ReadingStatus, string> = {
  want_to_read: "Want to Read",
  currently_reading: "Currently Reading",
  completed: "Completed",
  on_hold: "On Hold",
  abandoned: "Abandoned",
};

export default function LibraryDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { isAppOwner } = useAppOwner();
  const { channels } = useChannels("books");
  const userChannel = channels?.find((c) => c.user_id === user?.id);

  const ws = useLibraryWorkspace();

  const [activeTab, setActiveTab] = useState("overview");

  // Shelf form
  const [shelfName, setShelfName] = useState("");
  const [shelfDesc, setShelfDesc] = useState("");
  const [shelfColor, setShelfColor] = useState("#3b82f6");
  const [shelfVisibility, setShelfVisibility] = useState<"private" | "public">("private");
  const [selectedShelfId, setSelectedShelfId] = useState<string>("");
  const [assignBookId, setAssignBookId] = useState<string>("");

  // Progress updater form
  const [progressBookId, setProgressBookId] = useState<string>("");
  const [progressPage, setProgressPage] = useState<string>("1");
  const [progressStatus, setProgressStatus] = useState<ReadingStatus>("currently_reading");

  // Goal form
  const [goalTitle, setGoalTitle] = useState("");
  const [goalType, setGoalType] = useState<GoalType>("books");
  const [goalPeriod, setGoalPeriod] = useState<GoalPeriod>("monthly");
  const [goalTarget, setGoalTarget] = useState("5");
  const [goalEndDate, setGoalEndDate] = useState(
    new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
  );

  // Notes form
  const [noteBookId, setNoteBookId] = useState("");
  const [noteType, setNoteType] = useState<"note" | "highlight">("note");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [notePage, setNotePage] = useState("");

  // Loans form
  const [loanBookTitle, setLoanBookTitle] = useState("");
  const [loanAuthor, setLoanAuthor] = useState("");
  const [loanType, setLoanType] = useState<LoanType>("lent");
  const [loanPerson, setLoanPerson] = useState("");
  const [loanContact, setLoanContact] = useState("");
  const [loanDueDate, setLoanDueDate] = useState("");

  const summary = useMemo(
    () =>
      computeDashboardSummary({
        books: ws.books,
        shelvesCount: ws.shelves.filter((s) => !s.is_archived).length,
        progressRows: ws.progressRows,
      }),
    [ws.books, ws.shelves, ws.progressRows],
  );

  const unreadNotifications = ws.notifications.filter((n) => !n.is_read).length;

  const bookMap = useMemo(() => {
    const map = new Map<string, WorkspaceBookItem>();
    for (const b of ws.books) map.set(b.id, b);
    return map;
  }, [ws.books]);

  const handleCreateShelf = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await ws.createShelf.mutateAsync({
        name: shelfName,
        description: shelfDesc,
        color: shelfColor,
        visibility: shelfVisibility,
      });
      setShelfName("");
      setShelfDesc("");
      toast({ title: "Shelf Created", description: `"${shelfName.trim()}" added.` });
    } catch (err) {
      toast({
        title: "Could not create shelf",
        description: err instanceof Error ? err.message : "Database migration may be required.",
        variant: "destructive",
      });
    }
  };

  const handleAssignBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShelfId || !assignBookId) return;
    try {
      await ws.assignBookToShelf.mutateAsync({ shelfId: selectedShelfId, bookId: assignBookId });
      toast({ title: "Book Added to Shelf" });
      setAssignBookId("");
    } catch (err) {
      toast({
        title: "Failed to assign book",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const handleUpdateProgress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!progressBookId) return;
    const book = bookMap.get(progressBookId);
    try {
      await ws.updateReadingProgress.mutateAsync({
        bookId: progressBookId,
        currentPage: Number(progressPage || 0),
        totalPages: book?.pages ?? null,
        readingStatus: progressStatus,
      });
      toast({ title: "Reading Progress Saved" });
    } catch (err) {
      toast({
        title: "Progress Validation Error",
        description: err instanceof Error ? err.message : "Could not save progress.",
        variant: "destructive",
      });
    }
  };

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await ws.createGoal.mutateAsync({
        title: goalTitle,
        goalType,
        period: goalPeriod,
        targetValue: Number(goalTarget || 1),
        startDate: new Date().toISOString().slice(0, 10),
        endDate: goalEndDate,
      });
      setGoalTitle("");
      toast({ title: "Reading Goal Created" });
    } catch (err) {
      toast({
        title: "Goal Creation Failed",
        description: err instanceof Error ? err.message : "Could not save goal.",
        variant: "destructive",
      });
    }
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteBookId) {
      toast({ title: "Select a Book", description: "Choose a book for this note.", variant: "destructive" });
      return;
    }
    try {
      await ws.createNote.mutateAsync({
        bookId: noteBookId,
        noteType,
        title: noteTitle,
        content: noteContent,
        pageNumber: notePage ? Number(notePage) : null,
      });
      setNoteTitle("");
      setNoteContent("");
      setNotePage("");
      toast({ title: "Note Saved" });
    } catch (err) {
      toast({
        title: "Note Save Failed",
        description: err instanceof Error ? err.message : "Could not save note.",
        variant: "destructive",
      });
    }
  };

  const handleCreateLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await ws.createLoan.mutateAsync({
        bookTitle: loanBookTitle,
        authorName: loanAuthor,
        loanType,
        counterpartyName: loanPerson,
        counterpartyContact: loanContact,
        loanDate: new Date().toISOString().slice(0, 10),
        expectedReturnDate: loanDueDate || undefined,
      });
      setLoanBookTitle("");
      setLoanAuthor("");
      setLoanPerson("");
      setLoanContact("");
      toast({ title: "Circulation Record Saved" });
    } catch (err) {
      toast({
        title: "Loan Save Failed",
        description: err instanceof Error ? err.message : "Could not save record.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-subtle pb-16">
      <SEO
        title="Library Workspace & Analytics — Sha-Verse Bookshelf"
        description="Manage custom shelves, reading goals, personal notes, borrowed & lent books, ISBN imports, and reading analytics."
        path="/dashboard"
      />

      <header className="sticky top-0 z-40 bg-card/85 backdrop-blur-lg border-b border-border">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/bookshelf")} aria-label="Back to Bookshelf">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                <Library className="w-5 h-5 text-primary" />
                Library Workspace
              </h1>
              <p className="text-xs text-muted-foreground">
                Shelves, Goals, Notes, Circulation &amp; Reading Analytics
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/settings")} className="gap-1.5">
              <SettingsIcon className="w-4 h-4" />
              Settings
            </Button>
            {isAppOwner && (
              <Button variant="outline" size="sm" onClick={() => navigate("/admin")} className="gap-1.5">
                <Shield className="w-4 h-4 text-primary" />
                Admin
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-6 space-y-6">
        {ws.schemaMissing && (
          <Card className="p-4 border-amber-500/40 bg-amber-500/10 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm space-y-1">
              <p className="font-semibold text-foreground">Workspace SQL Migration Pending in Supabase</p>
              <p className="text-muted-foreground">
                Run <code>supabase/migrations/20261120000000_bookshelf_management_complete.sql</code> in Supabase Dashboard → SQL Editor to activate persistent Shelves, Goals, Synced Notes, Loans, and Notifications tables.
              </p>
            </div>
          </Card>
        )}

        {/* Summary Cards */}
        <section aria-label="Library Summary Metrics" className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {[
            { label: "Total Books", value: summary.totalBooks, icon: BookOpen, color: "text-blue-600" },
            { label: "Custom Shelves", value: summary.totalShelves, icon: Layers, color: "text-indigo-600" },
            { label: "Reading Now", value: summary.currentlyReading, icon: Clock, color: "text-amber-600" },
            { label: "Completed", value: summary.completedBooks, icon: CheckCircle2, color: "text-emerald-600" },
            { label: "Unread", value: summary.unreadBooks, icon: Bookmark, color: "text-slate-600" },
            { label: "Authors", value: summary.totalAuthors, icon: Users, color: "text-purple-600" },
            { label: "Categories", value: summary.totalCategories, icon: Library, color: "text-cyan-600" },
            { label: "Pages Read", value: summary.totalPagesRead, icon: Target, color: "text-rose-600" },
          ].map((stat) => (
            <Card key={stat.label} className="p-3.5">
              <div className="flex items-center justify-between mb-1">
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <div className="text-xl sm:text-2xl font-bold">{stat.value}</div>
              <div className="text-[11px] text-muted-foreground truncate">{stat.label}</div>
            </Card>
          ))}
        </section>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="flex w-full overflow-x-auto justify-start h-auto p-1 gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="shelves">Shelves ({ws.shelves.length})</TabsTrigger>
            <TabsTrigger value="goals">Goals &amp; Progress</TabsTrigger>
            <TabsTrigger value="notes">Notes ({ws.notes.length})</TabsTrigger>
            <TabsTrigger value="loans">Borrowed &amp; Lent ({ws.loans.length})</TabsTrigger>
            <TabsTrigger value="import-export">Import / Export / ISBN</TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5">
              <Bell className="w-3.5 h-3.5" />
              Alerts {unreadNotifications > 0 ? `(${unreadNotifications})` : ""}
            </TabsTrigger>
          </TabsList>

          {/* OVERVIEW */}
          <TabsContent value="overview" className="space-y-6">
            {ws.isLoading ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : (
              <DashboardAnalyticsCharts books={ws.books} summary={summary} />
            )}

            <Card className="p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Recent Reading Activity</h3>
                <Button variant="ghost" size="sm" onClick={() => setActiveTab("goals")}>
                  Update Progress
                </Button>
              </div>
              {ws.progressRows.length > 0 ? (
                <div className="space-y-3">
                  {ws.progressRows.slice(0, 6).map((row) => {
                    const total = row.total_pages || row.book?.pages || 0;
                    const curr = row.current_page ?? 0;
                    const pct = total > 0 ? Math.min(100, Math.round((curr / total) * 100)) : row.completed ? 100 : 0;
                    const statusKey = (row.reading_status || (row.completed ? "completed" : "currently_reading")) as ReadingStatus;
                    return (
                      <div key={row.book_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-2.5 last:border-0">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{row.book?.title || "Untitled Book"}</p>
                          <p className="text-xs text-muted-foreground">{row.book?.author || "Unknown Author"}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <Badge variant="secondary">{STATUS_LABELS[statusKey] || statusKey}</Badge>
                          <span className="text-xs font-medium w-24 text-right">
                            {total > 0 ? `${curr}/${total} (${pct}%)` : `Page ${curr}`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No reading sessions recorded yet. Open any book to start tracking progress.</p>
              )}
            </Card>
          </TabsContent>

          {/* SHELVES */}
          <TabsContent value="shelves" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="p-5 space-y-4">
                <h3 className="text-base font-semibold flex items-center gap-2">
                  <FolderPlus className="w-4 h-4 text-primary" />
                  Create Custom Shelf
                </h3>
                <form onSubmit={handleCreateShelf} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="shelf-name">Shelf Name</Label>
                    <Input
                      id="shelf-name"
                      value={shelfName}
                      onChange={(e) => setShelfName(e.target.value)}
                      placeholder="e.g., Classics, Sci-Fi Favorites, Exam Prep"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="shelf-desc">Description</Label>
                    <Input
                      id="shelf-desc"
                      value={shelfDesc}
                      onChange={(e) => setShelfDesc(e.target.value)}
                      placeholder="Optional note about this shelf"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="shelf-color">Color Tag</Label>
                      <Input
                        id="shelf-color"
                        type="color"
                        value={shelfColor}
                        onChange={(e) => setShelfColor(e.target.value)}
                        className="h-10 p-1"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="shelf-visibility">Visibility</Label>
                      <select
                        id="shelf-visibility"
                        value={shelfVisibility}
                        onChange={(e) => setShelfVisibility(e.target.value as "private" | "public")}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="private">Private</option>
                        <option value="public">Public</option>
                      </select>
                    </div>
                  </div>
                  <Button type="submit" disabled={ws.createShelf.isPending || !shelfName.trim()}>
                    {ws.createShelf.isPending ? "Creating..." : "Create Shelf"}
                  </Button>
                </form>
              </Card>

              <Card className="p-5 space-y-4">
                <h3 className="text-base font-semibold flex items-center gap-2">
                  <Plus className="w-4 h-4 text-primary" />
                  Assign Book to Shelf
                </h3>
                <form onSubmit={handleAssignBook} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="target-shelf">Select Shelf</Label>
                    <select
                      id="target-shelf"
                      value={selectedShelfId}
                      onChange={(e) => setSelectedShelfId(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      required
                    >
                      <option value="">Choose a shelf...</option>
                      {ws.shelves.filter((s) => !s.is_archived).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.visibility})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="target-book">Select Book</Label>
                    <select
                      id="target-book"
                      value={assignBookId}
                      onChange={(e) => setAssignBookId(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      required
                    >
                      <option value="">Choose a book...</option>
                      {ws.books.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title} — {b.author}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button type="submit" disabled={!selectedShelfId || !assignBookId || ws.assignBookToShelf.isPending}>
                    Add Book to Shelf
                  </Button>
                </form>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {ws.shelves.map((shelf) => {
                const mappings = ws.shelfBooks.filter((sb) => sb.shelf_id === shelf.id);
                return (
                  <Card key={shelf.id} className="p-4 flex flex-col justify-between gap-3">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: shelf.color }} />
                          <h4 className="font-semibold text-sm truncate">{shelf.name}</h4>
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-[10px]">
                            {shelf.visibility}
                          </Badge>
                          {shelf.is_archived && <Badge variant="secondary">Archived</Badge>}
                        </div>
                      </div>
                      {shelf.description && (
                        <p className="text-xs text-muted-foreground mt-1">{shelf.description}</p>
                      )}
                      <div className="mt-3 space-y-1.5">
                        {mappings.length > 0 ? (
                          mappings.map((m) => {
                            const b = bookMap.get(m.book_id);
                            return (
                              <div key={m.id} className="flex items-center justify-between gap-2 text-xs bg-muted/40 rounded px-2 py-1">
                                <span className="truncate">{b?.title || "Book"}</span>
                                <button
                                  type="button"
                                  onClick={() => ws.removeBookFromShelf.mutate({ shelfId: shelf.id, bookId: m.book_id })}
                                  aria-label={`Remove ${b?.title || "book"} from ${shelf.name}`}
                                  className="text-muted-foreground hover:text-destructive shrink-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-xs text-muted-foreground italic">No books assigned yet.</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => ws.toggleShelfArchived.mutate({ shelfId: shelf.id, isArchived: !shelf.is_archived })}
                        className="gap-1 text-xs"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        {shelf.is_archived ? "Unarchive" : "Archive"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive text-xs gap-1"
                        onClick={() => ws.deleteShelf.mutate(shelf.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </Button>
                    </div>
                  </Card>
                );
              })}
              {ws.shelves.length === 0 && (
                <Card className="p-6 col-span-full text-center text-sm text-muted-foreground">
                  No custom shelves created yet. Create your first shelf above to organize your books cleanly without duplication.
                </Card>
              )}
            </div>
          </TabsContent>

          {/* GOALS & PROGRESS */}
          <TabsContent value="goals" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="p-5 space-y-4">
                <h3 className="text-base font-semibold flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary" />
                  Update Book Reading Progress &amp; Status
                </h3>
                <form onSubmit={handleUpdateProgress} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="progress-book">Book</Label>
                    <select
                      id="progress-book"
                      value={progressBookId}
                      onChange={(e) => setProgressBookId(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      required
                    >
                      <option value="">Select book...</option>
                      {ws.books.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title} {b.pages ? `(${b.pages}p)` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="progress-page">Current Page</Label>
                      <Input
                        id="progress-page"
                        type="number"
                        min={0}
                        value={progressPage}
                        onChange={(e) => setProgressPage(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="progress-status">Reading Status</Label>
                      <select
                        id="progress-status"
                        value={progressStatus}
                        onChange={(e) => setProgressStatus(e.target.value as ReadingStatus)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="want_to_read">Want to Read</option>
                        <option value="currently_reading">Currently Reading</option>
                        <option value="completed">Completed</option>
                        <option value="on_hold">On Hold</option>
                        <option value="abandoned">Abandoned</option>
                      </select>
                    </div>
                  </div>
                  <Button type="submit" disabled={!progressBookId || ws.updateReadingProgress.isPending}>
                    Save Progress
                  </Button>
                </form>
              </Card>

              <Card className="p-5 space-y-4">
                <h3 className="text-base font-semibold flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  Create Reading Goal
                </h3>
                <form onSubmit={handleCreateGoal} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="goal-title">Goal Title</Label>
                    <Input
                      id="goal-title"
                      value={goalTitle}
                      onChange={(e) => setGoalTitle(e.target.value)}
                      placeholder="e.g., Read 5 Books This Month"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="goal-type">Metric</Label>
                      <select
                        id="goal-type"
                        value={goalType}
                        onChange={(e) => setGoalType(e.target.value as GoalType)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                      >
                        <option value="books">Books</option>
                        <option value="pages">Pages</option>
                        <option value="minutes">Minutes</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="goal-period">Period</Label>
                      <select
                        id="goal-period"
                        value={goalPeriod}
                        onChange={(e) => setGoalPeriod(e.target.value as GoalPeriod)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="goal-target">Target</Label>
                      <Input
                        id="goal-target"
                        type="number"
                        min={1}
                        value={goalTarget}
                        onChange={(e) => setGoalTarget(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="goal-end">Target End Date</Label>
                    <Input
                      id="goal-end"
                      type="date"
                      value={goalEndDate}
                      onChange={(e) => setGoalEndDate(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" disabled={!goalTitle.trim() || ws.createGoal.isPending}>
                    Create Goal
                  </Button>
                </form>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ws.goals.map((goal) => {
                const stats = computeGoalProgress(goal, ws.progressRows);
                return (
                  <Card key={goal.id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-semibold text-sm">{goal.title}</h4>
                        <p className="text-xs text-muted-foreground">
                          {goal.period} · Ends {goal.end_date}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={stats.achieved ? "default" : "secondary"}>
                          {stats.achieved ? "Completed" : `${stats.percent}%`}
                        </Badge>
                        <button
                          type="button"
                          onClick={() => ws.deleteGoal.mutate(goal.id)}
                          aria-label={`Delete goal ${goal.title}`}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <Progress value={stats.percent} className="h-2" />
                    <p className="text-xs text-muted-foreground">
                      {stats.currentValue} / {stats.targetValue} {goal.goal_type}
                    </p>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* NOTES */}
          <TabsContent value="notes" className="space-y-6">
            <Card className="p-5 space-y-4">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-primary" />
                Add Personal Note or Highlight (Private to Your Account)
              </h3>
              <form onSubmit={handleCreateNote} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="note-book">Book</Label>
                    <select
                      id="note-book"
                      value={noteBookId}
                      onChange={(e) => setNoteBookId(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      required
                    >
                      <option value="">Select book...</option>
                      {ws.books.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="note-type">Type</Label>
                    <select
                      id="note-type"
                      value={noteType}
                      onChange={(e) => setNoteType(e.target.value as "note" | "highlight")}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="note">Note</option>
                      <option value="highlight">Highlight</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="note-page">Page Number</Label>
                    <Input
                      id="note-page"
                      type="number"
                      min={1}
                      value={notePage}
                      onChange={(e) => setNotePage(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="note-title">Heading / Chapter</Label>
                  <Input
                    id="note-title"
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder="Optional heading"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="note-content">Note / Highlight Text</Label>
                  <Textarea
                    id="note-content"
                    rows={3}
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="Write your takeaway or passage quote..."
                    required
                  />
                </div>
                <Button type="submit" disabled={ws.createNote.isPending}>
                  Save Note
                </Button>
              </form>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ws.notes.map((note) => {
                const book = bookMap.get(note.book_id);
                return (
                  <Card key={note.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-primary">{book?.title || "Book"}</p>
                        {note.title && <h4 className="font-semibold text-sm">{note.title}</h4>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{note.note_type}</Badge>
                        {note.page_number && <Badge variant="secondary">p. {note.page_number}</Badge>}
                        <button
                          type="button"
                          onClick={() => ws.deleteNote.mutate(note.id)}
                          aria-label="Delete note"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap">{note.content}</p>
                  </Card>
                );
              })}
              {ws.notes.length === 0 && (
                <Card className="p-6 col-span-full text-center text-sm text-muted-foreground">
                  No synced notes yet. Your private notes and highlights will appear here.
                </Card>
              )}
            </div>
          </TabsContent>

          {/* BORROWED & LENT */}
          <TabsContent value="loans" className="space-y-6">
            <Card className="p-5 space-y-4">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-primary" />
                Track Borrowed or Lent Book
              </h3>
              <form onSubmit={handleCreateLoan} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="loan-book">Book Title</Label>
                  <Input
                    id="loan-book"
                    value={loanBookTitle}
                    onChange={(e) => setLoanBookTitle(e.target.value)}
                    required
                    placeholder="Book title"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loan-author">Author</Label>
                  <Input
                    id="loan-author"
                    value={loanAuthor}
                    onChange={(e) => setLoanAuthor(e.target.value)}
                    placeholder="Author name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loan-type">Loan Type</Label>
                  <select
                    id="loan-type"
                    value={loanType}
                    onChange={(e) => setLoanType(e.target.value as LoanType)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="lent">Lent to Someone</option>
                    <option value="borrowed">Borrowed from Someone</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loan-person">Person / Library Name</Label>
                  <Input
                    id="loan-person"
                    value={loanPerson}
                    onChange={(e) => setLoanPerson(e.target.value)}
                    required
                    placeholder="e.g., Rahul Sharma"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loan-contact">Contact (Phone / Email)</Label>
                  <Input
                    id="loan-contact"
                    value={loanContact}
                    onChange={(e) => setLoanContact(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loan-due">Expected Return Date</Label>
                  <Input
                    id="loan-due"
                    type="date"
                    value={loanDueDate}
                    onChange={(e) => setLoanDueDate(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <Button type="submit" disabled={ws.createLoan.isPending}>
                    Save Circulation Record
                  </Button>
                </div>
              </form>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ws.loans.map((loan) => {
                const effective = resolveEffectiveLoanStatus(loan);
                return (
                  <Card key={loan.id} className="p-4 flex flex-col justify-between gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-semibold text-sm">{loan.book_title}</h4>
                        <p className="text-xs text-muted-foreground">
                          {loan.loan_type === "lent" ? `Lent to ${loan.counterparty_name}` : `Borrowed from ${loan.counterparty_name}`}
                          {loan.expected_return_date ? ` · Due ${loan.expected_return_date}` : ""}
                        </p>
                      </div>
                      <Badge
                        variant={effective === "overdue" ? "destructive" : effective === "returned" ? "secondary" : "default"}
                      >
                        {effective}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {effective !== "returned" && (
                        <Button size="sm" variant="outline" onClick={() => ws.markLoanReturned.mutate(loan.id)}>
                          Mark Returned
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => ws.deleteLoan.mutate(loan.id)}
                        aria-label={`Delete loan for ${loan.book_title}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </Card>
                );
              })}
              {ws.loans.length === 0 && (
                <Card className="p-6 col-span-full text-center text-sm text-muted-foreground">
                  No borrowed or lent books tracked yet.
                </Card>
              )}
            </div>
          </TabsContent>

          {/* IMPORT / EXPORT / ISBN */}
          <TabsContent value="import-export">
            <ImportExportTab books={ws.books} userChannelId={userChannel?.id} userId={user?.id} />
          </TabsContent>

          {/* NOTIFICATIONS */}
          <TabsContent value="notifications" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Notifications</h3>
              {unreadNotifications > 0 && (
                <Button size="sm" variant="outline" onClick={() => ws.markAllNotificationsRead.mutate()}>
                  Mark All Read
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {ws.notifications.map((n) => (
                <Card key={n.id} className={`p-4 flex items-start justify-between gap-3 ${!n.is_read ? "border-primary/40 bg-primary/5" : ""}`}>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{n.title}</span>
                      <Badge variant="outline" className="text-[10px]">{n.category}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{n.message}</p>
                  </div>
                  {!n.is_read && (
                    <Button size="sm" variant="ghost" onClick={() => ws.markNotificationRead.mutate(n.id)}>
                      Mark Read
                    </Button>
                  )}
                </Card>
              ))}
              {ws.notifications.length === 0 && (
                <Card className="p-6 text-center text-sm text-muted-foreground">
                  You are all caught up — no unread notifications.
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
