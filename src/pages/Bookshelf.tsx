import { useState } from "react";
import { SEO } from "@/components/seo/SEO";

import { useNavigate } from "react-router-dom";

import { useQuery } from "@tanstack/react-query";

import { Book, Plus, Search, TrendingUp, Clock, Users, Grid, List, BookOpen, Heart, ChevronDown, ChevronUp, X, User, LogOut, Mail, Phone, Flame, Eye, ThumbsUp, ArrowRight, LayoutDashboard, Settings as SettingsIcon, Shield } from "lucide-react";

import { Card } from "@/components/ui/card";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { Badge } from "@/components/ui/badge";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useBooks } from "@/hooks/useBooks";

import { useChannels } from "@/hooks/useChannels";

import { useSavedBooks, useSubscribedBookChannels, useSubscribedBooks, useVisibleBookChannels } from "@/hooks/useBookFeeds";
import {
  computeReadingProgressStats,
  filterReadingHistory,
  formatWeekRangeLabel,
  getCurrentWeekWindow,
  type LibraryProgressFilter,
} from "@/lib/bookshelf/trending";

import { useAuth } from "@/contexts/AuthContext";
import { useAppOwner } from "@/hooks/useAppOwner";
import { getProfileMenuVisibility } from "@/modules/bookshelf/lib/profileMenuAccess";

import { supabase } from "@/integrations/supabase/client";

import UploadBookDialog from "@/components/bookshelf/UploadBookDialog";

import CreateAuthorChannelDialog from "@/components/bookshelf/CreateAuthorChannelDialog";

import BookCard from "@/components/bookshelf/BookCard";

import { formatDistanceToNow } from "date-fns";

import { BOOK_CATEGORIES } from "@/lib/constants/bookshelf";

import { NativeAdSlot, SponsoredBookCard } from "@/components/ads";
import AppLogoStatusRing from "@/components/promotions/AppLogoStatusRing";
import { BOOK_PUBLIC_COLUMNS } from "@/lib/constants/bookshelf";



const Bookshelf = () => {

  const navigate = useNavigate();

  const { user, signOut } = useAuth();
  const { isAppOwner } = useAppOwner();
  const profileMenu = getProfileMenuVisibility(isAppOwner);



  // Independent pagination states for different tabs could be better, 

  // but to keep UI simple we'll reset page on tab switch.

  const [activeTab, setActiveTab] = useState("discover");

  const [page, setPage] = useState(0);



  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const [searchQuery, setSearchQuery] = useState("");
  const [copyrightOpen, setCopyrightOpen] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedSubscribedAuthorId, setSelectedSubscribedAuthorId] = useState<string | null>(null);
  const [libraryFilter, setLibraryFilter] = useState<LibraryProgressFilter>("all");

  const [showUploadDialog, setShowUploadDialog] = useState(false);

  const [showCreateChannelDialog, setShowCreateChannelDialog] = useState(false);

  const weekWindow = getCurrentWeekWindow();
  const weekRangeLabel = formatWeekRangeLabel(weekWindow.weekStartIso, weekWindow.weekEndIso);



  // Main Feed & Trending (via useBooks wrapper)

  const { books, trendingBooks, isLoading } = useBooks({

    page,

    limit: 20,

    search: searchQuery,

    category: selectedCategory,

  });



  const { channels } = useChannels("books");

  // Hide seed-only demo author channels from public author listings
  // (non-destructive — see useVisibleBookChannels / HIDE_SEED_BOOKS).
  const visibleChannels = useVisibleBookChannels(channels);



  // Get user's book channel

  const userChannel = channels?.find((c) => c.user_id === user?.id);



  // Subscribed book channels & books feed for Subscribed tab
  const { data: subscribedChannels = [] } = useSubscribedBookChannels();
  // Also hide seed-only demo authors from the Subscribed tab.
  const visibleSubscribedChannels = useVisibleBookChannels(subscribedChannels as { id: string }[]);

  const { data: subscribedBooks = [], isLoading: isLoadingSubscribedBooks } = useSubscribedBooks({
    search: searchQuery,
    category: selectedCategory,
    channelId: selectedSubscribedAuthorId,
    page: activeTab === "subscribed" ? page : 0,
    limit: 20,
  });

  // Saved Books (Server-Side Filtered & Paginated)

  const { data: savedBooks = [] } = useSavedBooks({

    search: searchQuery,

    category: selectedCategory,

    page: activeTab === 'library' ? page : 0,

    limit: 20

  });



  // Fetch reading history (Keep existing logic, maybe move to hook later)

  const { data: readingHistory = [] } = useQuery({

    queryKey: ["reading-history", user?.id],

    queryFn: async () => {

      if (!user?.id) return [];



      const { data } = await (supabase as any)

        .from("book_reading_progress")

        .select(`

          id, current_page, total_pages, completed, last_read_at,

          book:books(${BOOK_PUBLIC_COLUMNS}, channel:channels!books_channel_id_fkey(id, name, avatar_url, user_id))

        `)

        .eq("user_id", user.id)

        .order("last_read_at", { ascending: false })

        .limit(20);



      return data || [];

    },

    enabled: !!user?.id,

  });



  const categories = [

    { name: "All", icon: Grid },

    ...BOOK_CATEGORIES.map(cat => ({ name: cat, icon: Book }))

  ];



  const handleTabChange = (value: string) => {

    setActiveTab(value);

    setPage(0); // Reset pagination on tab change

  };



  const renderPagination = (itemsCount: number) => {

    if (itemsCount === 0 && page === 0) return null;



    return (

      <div className="flex items-center justify-center gap-4 mt-6">

        <Button

          variant="outline"

          onClick={() => setPage(p => Math.max(0, p - 1))}

          disabled={page === 0}

        >

          Previous

        </Button>

        <span className="text-sm text-muted-foreground">Page {page + 1}</span>

        <Button

          variant="outline"

          onClick={() => setPage(p => p + 1)}

          disabled={itemsCount < 20}

        >

          Next

        </Button>

      </div>

    );

  };

  // Interleaves a SponsoredBookCard (book-shaped native ad) every `every` items.
  const renderBooksWithAds = (items: any[], every = 4, keyPrefix = "ad") => {
    return items.flatMap((book, idx) => {
      const card = <BookCard key={book.id} book={book} />;
      if ((idx + 1) % every === 0 && idx !== items.length - 1) {
        return [
          card,
          <div key={`${keyPrefix}-${book.id}`} className="min-w-0">
            <SponsoredBookCard />
            <NativeAdSlot placement="BS_GRID_01" slotKey={`${keyPrefix}-${book.id}`} />
          </div>,
        ];
      }
      return [card];
    });
  };



  return (

    <div className="min-h-screen bg-gradient-subtle pb-20">

      <SEO
        title="Bookshelf — Read & Share Books on Sha-Verse"
        description="Discover, read, and share books on the Sha-Verse Bookshelf. Browse author channels, track reading progress, and build your library."
        path="/bookshelf"
      />


      {/* Header */}

      <header className="sticky top-0 z-40 bg-card/80 backdrop-blur-lg border-b border-border shadow-sm">

        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">

          <div className="flex items-center justify-between gap-4">

            <div className="flex items-center gap-2">

              <AppLogoStatusRing
                src="/sha-verse-logo.jpeg"
                alt="Sha-Verse"
                size="w-9 h-9"
                showPlus
              />


              <h1 className="text-xl sm:text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">

                Bookshelf

              </h1>

            </div>



            <div className="flex-1 max-w-md hidden sm:block">

              <div className="relative">

                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />

                <Input

                  placeholder="Search books or authors..."

                  value={searchQuery}

                  onChange={(e) => {

                    setSearchQuery(e.target.value);

                    setPage(0); // Reset page on search

                  }}

                  className="pl-10"

                />

              </div>

            </div>



            <div className="flex items-center gap-2 sm:gap-3">
              {userChannel ? (
                <>
                  <Button
                    onClick={() => setShowUploadDialog(true)}
                    size="icon"
                    variant="ghost"
                    aria-label="Upload Book"
                    title="Upload Book"
                    className="rounded-full w-9 h-9 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <div
                        className="relative cursor-pointer group"
                        role="button"
                        tabIndex={0}
                        aria-label="Channel and account menu"
                      >
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-pink-600 to-purple-600 rounded-full opacity-75 group-hover:opacity-100 blur-[2px] transition duration-200"></div>
                        <Avatar className="w-9 h-9 border-2 border-background relative">
                          <AvatarImage src={userChannel.avatar_url || ""} className="object-cover" />
                          <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-500 text-white text-xs">
                            {userChannel.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {profileMenu.showYourChannel && (
                        <DropdownMenuItem
                          onSelect={() => navigate(`/bookshelf/channel/${userChannel.id}`)}
                          className="cursor-pointer"
                        >
                          <User className="w-4 h-4 mr-2" />
                          Your Channel
                        </DropdownMenuItem>
                      )}
                      {profileMenu.showLibraryWorkspace && (
                        <DropdownMenuItem
                          onSelect={() => navigate("/dashboard")}
                          className="cursor-pointer"
                        >
                          <LayoutDashboard className="w-4 h-4 mr-2" />
                          Library Workspace
                        </DropdownMenuItem>
                      )}
                      {profileMenu.showAccountSettings && (
                        <DropdownMenuItem
                          onSelect={() => navigate("/settings")}
                          className="cursor-pointer"
                        >
                          <SettingsIcon className="w-4 h-4 mr-2" />
                          Account &amp; Settings
                        </DropdownMenuItem>
                      )}
                      {profileMenu.showAdminPanel && (
                        <DropdownMenuItem
                          onSelect={() => navigate("/admin")}
                          className="cursor-pointer"
                        >
                          <Shield className="w-4 h-4 mr-2 text-primary" />
                          Admin Panel
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => void signOut()}
                        className="cursor-pointer text-destructive focus:text-destructive"
                      >
                        <LogOut className="w-4 h-4 mr-2" />
                        Logout
                      </DropdownMenuItem>
                      {(user?.email || user?.phone) && (
                        <>
                          <DropdownMenuSeparator />
                          <div
                            className="px-2.5 py-2 flex items-center gap-2 text-xs text-muted-foreground select-all"
                            title={user.email || user.phone || ""}
                          >
                            {user.email ? (
                              <Mail className="w-3.5 h-3.5 shrink-0 text-primary/80" />
                            ) : (
                              <Phone className="w-3.5 h-3.5 shrink-0 text-primary/80" />
                            )}
                            <span className="truncate font-medium text-foreground/85">
                              {user.email || user.phone}
                            </span>
                          </div>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <>
                  {profileMenu.showAccountSettings && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => navigate("/settings")}
                      aria-label="Account Settings"
                      title="Account Settings"
                    >
                      <SettingsIcon className="w-4 h-4" />
                    </Button>
                  )}
                  <Button onClick={() => setShowCreateChannelDialog(true)} size="sm" className="bg-gradient-primary text-white border-0">
                    <Plus className="w-4 h-4 mr-1" />
                    Become an Author
                  </Button>
                </>
              )}
            </div>

          </div>



          {/* Mobile Search */}

          <div className="mt-3 sm:hidden">

            <div className="relative">

              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />

              <Input

                placeholder="Search books..."

                value={searchQuery}

                onChange={(e) => {

                  setSearchQuery(e.target.value);

                  setPage(0);

                }}

                className="pl-10"

              />

            </div>

          </div>

        </div>

      </header>



      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6">

        {/* Copyright Warning - Collapsible */}
        <div
          role="alert"
          className="mb-4 rounded-lg border-2 border-destructive/40 bg-destructive/10 dark:bg-destructive/15 shadow-sm overflow-hidden"
        >
          <button
            type="button"
            onClick={() => setCopyrightOpen((v) => !v)}
            aria-expanded={copyrightOpen}
            aria-controls="copyright-warning-body"
            className="w-full flex items-center gap-2 sm:gap-3 p-3 sm:p-4 text-left hover:bg-destructive/5 transition-colors"
          >
            <span aria-hidden className="text-lg sm:text-xl leading-none">⚠️</span>
            <h3 className="flex-1 font-bold text-destructive text-sm sm:text-base">
              Copyright Warning
            </h3>
            <span
              className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-destructive/20 text-destructive shrink-0"
              aria-hidden
            >
              {copyrightOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
          </button>
          {copyrightOpen && (
            <div id="copyright-warning-body" className="px-3 sm:px-4 pb-3 sm:pb-4 pt-0">
              <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed">
                Uploading or sharing copyrighted books without proper authorization is strictly prohibited on{" "}
                <strong>SHA-VERSE: BOOKSHELF</strong>. Any violation may result in immediate permanent suspension of the account
                and legal action in accordance with the copyright laws and regulations applicable in the user's
                respective country.
              </p>
            </div>
          )}
        </div>

        {/* Category Tabs */}

        <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide mb-4">

          {categories.map((cat) => (

            <Button

              key={cat.name}

              variant={selectedCategory === cat.name ? "default" : "outline"}

              size="sm"

              className="flex-shrink-0"

              onClick={() => {

                setSelectedCategory(cat.name);

                setPage(0);

              }}

            >

              <cat.icon className="w-4 h-4 mr-1" />

              {cat.name}

            </Button>

          ))}

        </div>



        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">

          <TabsList
            data-no-swipe-nav="true"
            className="grid grid-cols-4 w-full max-w-md relative z-10"
          >

            <TabsTrigger value="discover" data-no-swipe-nav="true">Discover</TabsTrigger>

            <TabsTrigger value="trending" data-no-swipe-nav="true">Trending</TabsTrigger>

            <TabsTrigger value="subscribed" data-no-swipe-nav="true">Subscribed</TabsTrigger>

            <TabsTrigger value="library" data-no-swipe-nav="true">Library</TabsTrigger>

          </TabsList>



          <TabsContent value="discover" className="space-y-6">

            {/* 1️⃣ Recently Added (now FIRST) */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Clock className="w-5 h-5 text-primary" />
                    Recently Added
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Newest launches first</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setViewMode("grid")}
                    className={viewMode === "grid" ? "bg-accent" : ""}
                  >
                    <Grid className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setViewMode("list")}
                    className={viewMode === "list" ? "bg-accent" : ""}
                  >
                    <List className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {viewMode === "grid" ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2 sm:gap-3">
                  {renderBooksWithAds(books, 4, "recent-ad")}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {books.map((book) => (
                    <Card
                      key={book.id}
                      className="p-3 flex gap-3 items-center hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => navigate(`/bookshelf/book/${book.id}`)}
                    >
                      <div className="w-12 h-16 flex-shrink-0 rounded overflow-hidden bg-gradient-primary">
                        {book.cover_url ? (
                          <img src={book.cover_url} alt={book.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Book className="w-5 h-5 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm line-clamp-1">{book.title}</h3>
                        <p className="text-xs text-muted-foreground line-clamp-1">{book.author}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {(book.views_count || 0)} views{book.pages ? ` • ${book.pages} pages` : ""}
                        </p>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {isLoading && (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2 sm:gap-3 mt-4">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <Card key={i} className="overflow-hidden animate-pulse">
                      <div className="aspect-[2/3] bg-muted" />
                      <div className="p-3 space-y-2">
                        <div className="h-4 bg-muted rounded" />
                        <div className="h-3 bg-muted rounded w-2/3" />
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {!isLoading && books.length === 0 && (
                <Card className="p-8 text-center">
                  <Book className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="font-semibold mb-2">No books found</h3>
                  <p className="text-muted-foreground text-sm">
                    {searchQuery ? "Try a different search term" : "Be the first to upload a book!"}
                  </p>
                </Card>
              )}

              {renderPagination(books.length)}
            </section>

            {/* 2️⃣ Trending Books */}
            <section>
              <div className="mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  Trending Books
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Weekly ranking · Auto-updates every week by views &amp; likes
                </p>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2 sm:gap-3">
                {renderBooksWithAds(trendingBooks.slice(0, 12), 4, "trend-ad")}
              </div>
            </section>

            {/* 3️⃣ Popular Authors (Channels) */}
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                Popular Authors
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {visibleChannels?.slice(0, 6).map((channel) => (
                  <Card
                    key={channel.id}
                    className="p-4 text-center hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => navigate(`/bookshelf/channel/${channel.id}`)}
                  >
                    <Avatar className="w-16 h-16 mx-auto mb-2">
                      <AvatarImage src={channel.avatar_url || ""} />
                      <AvatarFallback>{channel.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <h3 className="font-semibold text-sm line-clamp-1">{channel.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {channel.subscribers_count || 0} subscribers
                    </p>
                    <Badge variant="secondary" className="mt-2 text-xs">
                      Author
                    </Badge>
                  </Card>
                ))}
              </div>
            </section>

          </TabsContent>



          <TabsContent value="trending" className="space-y-6">

            {/* Weekly Trending Banner matching Screenshot 693 */}
            <div className="rounded-xl border border-amber-200/80 dark:border-amber-800/50 bg-gradient-to-r from-amber-50/95 via-orange-50/75 to-amber-50/95 dark:from-amber-950/40 dark:via-orange-950/30 dark:to-amber-950/40 px-4 py-3.5 sm:px-5 sm:py-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-orange-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <Flame className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold text-base sm:text-lg text-foreground">
                      Weekly Trending Books
                    </h2>
                    <span className="inline-flex items-center rounded-full bg-amber-400/90 text-amber-950 px-2.5 py-0.5 text-[11px] font-semibold">
                      Auto-Updated Weekly
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Highest Views &amp; Likes first · Auto-updates every week · Week of {weekRangeLabel}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant={viewMode === "grid" ? "default" : "ghost"}
                  size="icon"
                  aria-label="Grid view"
                  onClick={() => setViewMode("grid")}
                  className={viewMode === "grid" ? "bg-orange-600 hover:bg-orange-700 text-white" : ""}
                >
                  <Grid className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === "list" ? "default" : "ghost"}
                  size="icon"
                  aria-label="List view"
                  onClick={() => setViewMode("list")}
                  className={viewMode === "list" ? "bg-orange-600 hover:bg-orange-700 text-white" : ""}
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Ranked Trending Books */}
            <section>
              {trendingBooks.length > 0 ? (
                viewMode === "grid" ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                    {trendingBooks.map((book, idx) => (
                      <div key={book.id} className="min-w-0 flex flex-col">
                        <BookCard book={book} rankBadge={idx + 1} />
                        <div className="flex items-center justify-center gap-3 pt-1.5 text-xs font-medium text-muted-foreground">
                          <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                            <Eye className="w-3.5 h-3.5" />
                            <span className="text-foreground/85">{book.views_count || 0}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                            <ThumbsUp className="w-3.5 h-3.5" />
                            <span className="text-foreground/85">{book.likes_count || 0}</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {trendingBooks.map((book, idx) => (
                      <Card
                        key={book.id}
                        role="article"
                        tabIndex={0}
                        onClick={() => navigate(`/bookshelf/book/${book.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            navigate(`/bookshelf/book/${book.id}`);
                          }
                        }}
                        className="p-3 flex gap-3 items-center hover:shadow-md transition-shadow cursor-pointer"
                      >
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-300 font-bold text-xs shrink-0">
                          #{idx + 1}
                        </span>
                        <div className="w-12 h-16 flex-shrink-0 rounded overflow-hidden bg-gradient-primary">
                          {book.cover_url ? (
                            <img src={book.cover_url} alt={book.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Book className="w-5 h-5 text-white" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-sm line-clamp-1">{book.title}</h3>
                          <p className="text-xs text-muted-foreground line-clamp-1">{book.author}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                              <Eye className="w-3.5 h-3.5" /> {book.views_count || 0}
                            </span>
                            <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                              <ThumbsUp className="w-3.5 h-3.5" /> {book.likes_count || 0}
                            </span>
                            {book.pages ? <span>• {book.pages} pages</span> : null}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )
              ) : (
                <Card className="p-8 text-center">
                  <TrendingUp className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="font-semibold mb-2">No trending books in this category</h3>
                  <p className="text-muted-foreground text-sm">Try selecting a different category</p>
                </Card>
              )}
            </section>

            {/* Trending Author Channels */}
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                Trending Author Channels
              </h2>
              {visibleChannels && visibleChannels.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {visibleChannels.slice(0, 12).map((channel) => (
                    <Card
                      key={channel.id}
                      className="p-4 text-center hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => navigate(`/bookshelf/channel/${channel.id}`)}
                    >
                      <Avatar className="w-16 h-16 mx-auto mb-2">
                        <AvatarImage src={channel.avatar_url || ""} />
                        <AvatarFallback>{channel.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <h3 className="font-semibold text-sm line-clamp-1">{channel.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {channel.subscribers_count || 0} subscribers
                      </p>
                      <Badge variant="secondary" className="mt-2 text-xs">
                        Author
                      </Badge>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card className="p-6 text-center">
                  <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground text-sm">No author channels yet</p>
                </Card>
              )}
            </section>

          </TabsContent>



          <TabsContent value="subscribed" className="space-y-5">

            {visibleSubscribedChannels.length > 0 ? (
              <>
                {/* Horizontal Author Filter Chips matching Screenshot 694 */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSubscribedAuthorId(null);
                      setPage(0);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold shrink-0 transition-colors ${
                      selectedSubscribedAuthorId === null
                        ? "bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                        : "bg-card border border-border text-foreground hover:bg-accent"
                    }`}
                  >
                    All Authors ({visibleSubscribedChannels.length})
                  </button>

                  {visibleSubscribedChannels.map((channel: any) => {
                    const isSelected = selectedSubscribedAuthorId === channel.id;
                    return (
                      <button
                        key={channel.id}
                        type="button"
                        onClick={() => {
                          setSelectedSubscribedAuthorId(isSelected ? null : channel.id);
                          setPage(0);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shrink-0 border transition-colors ${
                          isSelected
                            ? "bg-blue-600 text-white border-blue-600 shadow-sm hover:bg-blue-700"
                            : "bg-card border-border text-foreground hover:bg-accent"
                        }`}
                      >
                        <Avatar className="w-5 h-5">
                          <AvatarImage src={channel.avatar_url || ""} />
                          <AvatarFallback className="text-[9px]">
                            {channel.name?.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate max-w-[140px]">{channel.name}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Subscribed Authors' Books Grid */}
                {isLoadingSubscribedBooks ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <Card key={i} className="overflow-hidden animate-pulse">
                        <div className="aspect-[2/3] bg-muted" />
                        <div className="p-3 space-y-2">
                          <div className="h-4 bg-muted rounded" />
                          <div className="h-3 bg-muted rounded w-2/3" />
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : subscribedBooks.length > 0 ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                      {subscribedBooks.map((book) => (
                        <BookCard key={book.id} book={book} />
                      ))}
                    </div>
                    {renderPagination(subscribedBooks.length)}
                  </>
                ) : (
                  <Card className="p-8 text-center">
                    <BookOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                    <h3 className="font-semibold mb-1">No books found</h3>
                    <p className="text-muted-foreground text-sm mb-4">
                      {selectedSubscribedAuthorId
                        ? "This author has not published any matching books yet."
                        : "Your subscribed authors haven't uploaded matching books yet."}
                    </p>
                    {selectedSubscribedAuthorId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedSubscribedAuthorId(null)}
                      >
                        Show All Subscribed Authors
                      </Button>
                    )}
                  </Card>
                )}
              </>
            ) : (
              <Card className="p-8 text-center">
                <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="font-semibold mb-2">No Subscriptions Yet</h3>
                <p className="text-muted-foreground text-sm mb-4">
                  Subscribe to author channels to see them here
                </p>
                <Button onClick={() => setActiveTab("discover")}>
                  Discover Authors
                </Button>
              </Card>
            )}

          </TabsContent>



          <TabsContent value="library" className="space-y-8">
            {(() => {
              const allTracked = filterReadingHistory(readingHistory as any[], {
                filter: "all",
                search: searchQuery,
                category: selectedCategory,
              });
              const filteredTracked = filterReadingHistory(readingHistory as any[], {
                filter: libraryFilter,
                search: searchQuery,
                category: selectedCategory,
              });

              return (
                <section className="space-y-4">
                  {/* Header matching Screenshot 695 */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-bold flex items-center gap-2">
                        <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        Reading In Progress ({allTracked.length})
                      </h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Books currently in your reading progress. Resume reading right where you stopped.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
                        <button
                          type="button"
                          onClick={() => setLibraryFilter("all")}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                            libraryFilter === "all"
                              ? "bg-card text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          All ({allTracked.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setLibraryFilter("in_progress")}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                            libraryFilter === "in_progress"
                              ? "bg-card text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          In Progress
                        </button>
                        <button
                          type="button"
                          onClick={() => setLibraryFilter("finished")}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                            libraryFilter === "finished"
                              ? "bg-card text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Finished
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          variant={viewMode === "grid" ? "default" : "ghost"}
                          size="icon"
                          aria-label="Grid view"
                          onClick={() => setViewMode("grid")}
                          className={viewMode === "grid" ? "bg-orange-600 hover:bg-orange-700 text-white" : ""}
                        >
                          <Grid className="w-4 h-4" />
                        </Button>
                        <Button
                          variant={viewMode === "list" ? "default" : "ghost"}
                          size="icon"
                          aria-label="List view"
                          onClick={() => setViewMode("list")}
                          className={viewMode === "list" ? "bg-orange-600 hover:bg-orange-700 text-white" : ""}
                        >
                          <List className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {filteredTracked.length > 0 ? (
                    viewMode === "grid" ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                        {filteredTracked.map((item: any) => {
                          if (!item.book) return null;
                          const stats = computeReadingProgressStats(item);
                          const timeAgo = item.last_read_at
                            ? formatDistanceToNow(new Date(item.last_read_at), { addSuffix: true }).replace(/^about\s+/i, "")
                            : "recently";

                          return (
                            <Card
                              key={item.id}
                              role="article"
                              tabIndex={0}
                              aria-label={`Resume ${item.book.title}`}
                              className="overflow-hidden cursor-pointer group hover:shadow-glow transition-all flex flex-col"
                              onClick={() => navigate(`/bookshelf/read/${item.book.id}`)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  navigate(`/bookshelf/read/${item.book.id}`);
                                }
                              }}
                            >
                              <div className="relative aspect-[2/3] bg-gradient-primary overflow-hidden">
                                {item.book.cover_url ? (
                                  <img
                                    src={item.book.cover_url}
                                    alt={item.book.title}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Book className="w-10 h-10 text-white" />
                                  </div>
                                )}

                                {/* Bottom Progress Overlay matching Screenshot 695 */}
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/65 to-transparent pt-8 pb-2 px-2.5 text-white">
                                  <div className="flex items-center justify-between text-[11px] font-medium mb-1">
                                    <span>{stats.percent}% read</span>
                                    <span>Page {stats.currentPage}/{stats.totalPages}</span>
                                  </div>
                                  <div className="h-1 w-full bg-white/25 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-blue-500 rounded-full transition-all"
                                      style={{ width: `${stats.percent}%` }}
                                    />
                                  </div>
                                </div>
                              </div>

                              <div className="p-2.5 sm:p-3 flex-1 flex flex-col justify-between">
                                <div>
                                  <h3 className="font-semibold text-xs sm:text-sm line-clamp-1">
                                    {item.book.title}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                    {item.book.author}
                                  </p>
                                </div>

                                <div className="flex items-center justify-between gap-2 mt-2.5 text-[11px]">
                                  <span className="text-muted-foreground truncate">{timeAgo}</span>
                                  <span className="inline-flex items-center gap-0.5 font-semibold text-blue-600 dark:text-blue-400 group-hover:underline shrink-0">
                                    Resume <ArrowRight className="w-3 h-3" />
                                  </span>
                                </div>
                              </div>
                            </Card>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {filteredTracked.map((item: any) => {
                          if (!item.book) return null;
                          const stats = computeReadingProgressStats(item);
                          const timeAgo = item.last_read_at
                            ? formatDistanceToNow(new Date(item.last_read_at), { addSuffix: true }).replace(/^about\s+/i, "")
                            : "recently";
                          return (
                            <Card
                              key={item.id}
                              role="article"
                              tabIndex={0}
                              className="p-4 flex gap-4 items-center hover:shadow-md transition-shadow cursor-pointer"
                              onClick={() => navigate(`/bookshelf/read/${item.book.id}`)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  navigate(`/bookshelf/read/${item.book.id}`);
                                }
                              }}
                            >
                              <div className="w-16 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-gradient-primary">
                                {item.book.cover_url ? (
                                  <img src={item.book.cover_url} alt={item.book.title} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Book className="w-6 h-6 text-white" />
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold line-clamp-1">{item.book.title}</h3>
                                <p className="text-sm text-muted-foreground">{item.book.author}</p>
                                <div className="mt-2">
                                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                                    <span>Page {stats.currentPage} of {stats.totalPages}</span>
                                    <span>{stats.percent}%</span>
                                  </div>
                                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-blue-500 rounded-full transition-all"
                                      style={{ width: `${stats.percent}%` }}
                                    />
                                  </div>
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">
                                  Last read {timeAgo}
                                </p>
                              </div>
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 shrink-0">
                                Resume <ArrowRight className="w-3.5 h-3.5" />
                              </span>
                            </Card>
                          );
                        })}
                      </div>
                    )
                  ) : (
                    <Card className="p-8 text-center">
                      <BookOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                      <p className="text-muted-foreground text-sm">
                        {allTracked.length === 0
                          ? "Start reading a book to track your progress here."
                          : "No books match this reading filter."}
                      </p>
                    </Card>
                  )}
                </section>
              );
            })()}

            {/* Saved Books Section */}
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Heart className="w-5 h-5 text-primary" />
                Saved Books ({savedBooks.length})
              </h2>
              {savedBooks.length > 0 ? (
                <>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2 sm:gap-3">
                    {renderBooksWithAds(savedBooks, 4, "saved-ad")}
                  </div>
                  {renderPagination(savedBooks.length)}
                </>
              ) : (
                <Card className="p-6 text-center">
                  <Heart className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground text-sm">No saved books yet</p>
                </Card>
              )}
            </section>

          </TabsContent>

        </Tabs>

      </div>



      {/* Dialogs */}

      <UploadBookDialog

        open={showUploadDialog}

        onOpenChange={setShowUploadDialog}

        channelId={userChannel?.id || ""}

      />



      <CreateAuthorChannelDialog

        open={showCreateChannelDialog}

        onOpenChange={setShowCreateChannelDialog}

      />

    </div >

  );

};



export default Bookshelf;

