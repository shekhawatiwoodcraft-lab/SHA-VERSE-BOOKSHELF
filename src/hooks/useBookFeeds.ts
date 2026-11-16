import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Book } from "@/hooks/useBooks";
import { useEffect, useCallback, useMemo } from "react";
import { BOOK_PUBLIC_COLUMNS, HIDE_SEED_BOOKS, SEED_BOOK_URL } from "@/lib/constants/bookshelf";
import { excludeSeedBooks, filterSeedBooks } from "@/modules/bookshelf/lib/seedFilter";

/**
 * Returns the set of "seed-only" author channel IDs — channels whose books are
 * ALL demo/seed books (book_url === SEED_BOOK_URL) with no real uploads. These
 * are the fake demo authors and should be hidden from author listings.
 *
 * Non-destructive: nothing is deleted; flip HIDE_SEED_BOOKS to false to reveal.
 * A channel with zero books is NOT treated as seed (genuine new authors are kept).
 */
export const useSeedAuthorChannelIds = () => {
    const { data } = useQuery({
        queryKey: ["seed-author-channel-ids"],
        queryFn: async () => {
            if (!HIDE_SEED_BOOKS) return [] as string[];

            // Channel IDs that have at least one seed book.
            const { data: seedRows } = await supabase
                .from("books")
                .select("channel_id")
                .eq("book_url", SEED_BOOK_URL);

            // Channel IDs that have at least one REAL (non-seed) book.
            const { data: realRows } = await supabase
                .from("books")
                .select("channel_id")
                .or(`book_url.is.null,book_url.neq.${SEED_BOOK_URL}`);

            const realIds = new Set((realRows || []).map((r: any) => r.channel_id));
            const hidden = new Set<string>();
            for (const r of seedRows || []) {
                const id = (r as any).channel_id;
                if (id && !realIds.has(id)) hidden.add(id);
            }
            return Array.from(hidden);
        },
        staleTime: 1000 * 60 * 5,
    });

    return useMemo(() => new Set(data || []), [data]);
};

/**
 * Convenience helper to strip seed-only author channels from a channel list.
 */
export const useVisibleBookChannels = <T extends { id: string }>(
    channels: T[] | null | undefined,
): T[] => {
    const hidden = useSeedAuthorChannelIds();
    return useMemo(() => {
        if (!channels) return [];
        if (!HIDE_SEED_BOOKS || hidden.size === 0) return channels;
        return channels.filter((c) => !hidden.has(c.id));
    }, [channels, hidden]);
};

import {
    getCurrentWeekWindow,
    rankTrendingBooks,
    sortDiscoverBooks,
    type WeeklyEventCounts,
} from "@/lib/bookshelf/trending";

export const useBookFeed = (options: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    channelId?: string;
} = {}) => {
    const {
        page = 0,
        limit = 20,
        search = "",
        category = "All",
        channelId,
    } = options;

    return useQuery({
        queryKey: ["books", "feed", { page, limit, search, category, channelId }],
        queryFn: async () => {
            let query = supabase
                .from("books")
                .select(`
          ${BOOK_PUBLIC_COLUMNS},
          channel:channels!books_channel_id_fkey(id, name, avatar_url, user_id)
        `)
                .order("created_at", { ascending: false })
                .order("id", { ascending: false });

            // Hide demo/seed books (non-destructive, reversible)
            query = excludeSeedBooks(query);

            if (channelId) {
                query = query.eq("channel_id", channelId);
            }

            if (search) {
                query = query.or(`title.ilike.%${search}%,author.ilike.%${search}%`);
            }

            if (category && category !== "All") {
                query = query.eq("category", category);
            }

            // Pagination
            query = query.range(page * limit, (page + 1) * limit - 1);

            const { data, error } = await query;
            if (error) throw error;
            return sortDiscoverBooks((data || []) as Book[]);
        },
        placeholderData: (previousData) => previousData,
        staleTime: 1000 * 60 * 1, // 1 minute stale time
    });
};

export const useTrendingBooks = (category: string = "All") => {
    const weekWindow = getCurrentWeekWindow();
    const queryClient = useQueryClient();

    // Auto-rollover timer: when the ISO week finishes, refresh Trending automatically
    useEffect(() => {
        const delay = Math.min(weekWindow.msUntilNextWeek, 60 * 60 * 1000);
        const timer = window.setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ["books", "trending"] });
        }, delay);
        return () => window.clearTimeout(timer);
    }, [weekWindow.weekKey, weekWindow.msUntilNextWeek, queryClient]);

    return useQuery({
        queryKey: ["books", "trending", category, weekWindow.weekKey],
        queryFn: async () => {
            let query = supabase
                .from("books")
                .select(`
          ${BOOK_PUBLIC_COLUMNS},
          channel:channels!books_channel_id_fkey(id, name, avatar_url, user_id)
        `)
                .order("views_count", { ascending: false })
                .order("likes_count", { ascending: false })
                .limit(60);

            // Hide demo/seed books (non-destructive, reversible)
            query = excludeSeedBooks(query);

            if (category && category !== "All") {
                query = query.eq("category", category);
            }

            const { data, error } = await query;
            if (error) throw error;
            const candidateBooks = (data || []) as Book[];
            if (candidateBooks.length === 0) return [];

            // Also incorporate weekly engagement events if table is present
            const weeklyByBook: Record<string, WeeklyEventCounts> = {};
            try {
                const bookIds = candidateBooks.map((b) => b.id);
                const { data: evRows, error: evErr } = await (supabase as any)
                    .from("book_analytics_events")
                    .select("book_id, event_type")
                    .in("book_id", bookIds)
                    .gte("created_at", weekWindow.weekStartIso)
                    .lt("created_at", weekWindow.weekEndIso)
                    .limit(2000);

                if (!evErr && Array.isArray(evRows)) {
                    for (const ev of evRows) {
                        if (!weeklyByBook[ev.book_id]) {
                            weeklyByBook[ev.book_id] = { views: 0, likes: 0, downloads: 0, comments: 0, shares: 0 };
                        }
                        if (ev.event_type === "view") weeklyByBook[ev.book_id].views += 1;
                        else if (ev.event_type === "like") weeklyByBook[ev.book_id].likes += 1;
                        else if (ev.event_type === "download") weeklyByBook[ev.book_id].downloads += 1;
                        else if (ev.event_type === "comment") weeklyByBook[ev.book_id].comments += 1;
                        else if (ev.event_type === "share") weeklyByBook[ev.book_id].shares += 1;
                    }
                }
            } catch {
                // Fallback gracefully to lifetime views + likes when event table isn't deployed
            }

            return rankTrendingBooks(
                candidateBooks,
                Object.keys(weeklyByBook).length > 0 ? weeklyByBook : undefined,
            ).slice(0, 20);
        },
        staleTime: 1000 * 60 * 2,
    });
};

export const useSubscribedBooks = (options: {
    search?: string;
    category?: string;
    channelId?: string | null;
    page?: number;
    limit?: number;
} = {}) => {
    const { user } = useAuth();
    const { search = "", category = "All", channelId = null, page = 0, limit = 20 } = options;
    const queryClient = useQueryClient();

    // Real-time listener for subscription changes to update the feed
    useEffect(() => {
        if (!user?.id) return;

        const rtChannel = supabase
            .channel(`feed-subscriptions-${user.id}-${Date.now()}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'subscriptions', filter: `user_id=eq.${user.id}` },
                () => {
                    queryClient.invalidateQueries({ queryKey: ["books", "subscribed", user.id] });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(rtChannel);
        };
    }, [user?.id, queryClient]);

    return useQuery({
        queryKey: ["books", "subscribed", user?.id, { search, category, channelId: channelId ?? null, page }],
        queryFn: async () => {
            if (!user?.id) return [];

            const { data: subs } = await (supabase as any)
                .from("subscriptions")
                .select("channel_id")
                .eq("user_id", user.id);

            if (!subs || subs.length === 0) return [];

            const channelIds = subs.map((s: any) => s.channel_id);
            if (channelId && !channelIds.includes(channelId)) return [];

            let query = (supabase as any)
                .from("books")
                .select(`${BOOK_PUBLIC_COLUMNS}, channel:channels!books_channel_id_fkey(id, name, avatar_url, user_id)`)
                .order("created_at", { ascending: false });

            if (channelId) {
                query = query.eq("channel_id", channelId);
            } else {
                query = query.in("channel_id", channelIds);
            }

            // Hide demo/seed books (non-destructive, reversible)
            query = excludeSeedBooks(query);

            if (search) {
                query = query.or(`title.ilike.%${search}%,author.ilike.%${search}%`);
            }

            if (category && category !== "All") {
                query = query.eq("category", category);
            }

            query = query.range(page * limit, (page + 1) * limit - 1);

            const { data: books, error } = await query;

            if (error) throw error;
            return (books || []) as Book[];
        },
        enabled: !!user?.id,
    });
};

export const useSavedBooks = (options: { search?: string; category?: string; page?: number; limit?: number } = {}) => {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const { search = "", category = "All", page = 0, limit = 20 } = options;

    useEffect(() => {
        if (!user?.id) return;
        const rt = supabase
            .channel(`saved-books-rt-${user.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'saved_books', filter: `user_id=eq.${user.id}` }, () => {
                queryClient.invalidateQueries({ queryKey: ["books", "saved", user.id] });
            })
            .subscribe();
        return () => { supabase.removeChannel(rt); };
    }, [user?.id, queryClient]);

    return useQuery({
        queryKey: ["books", "saved", user?.id, { search, category, page }],
        queryFn: async () => {
            if (!user?.id) return [];

            let query = (supabase as any)
                .from("saved_books")
                .select(`
            id,
            book:books!inner(${BOOK_PUBLIC_COLUMNS}, channel:channels!books_channel_id_fkey(id, name, avatar_url, user_id))
          `)
                .eq("user_id", user.id)
                .order("created_at", { ascending: false });

            // Note: For deep filtering on 'book' relation, Supabase/Postgrest syntax can be complex.
            // This simple filtering might fail if syntax is improper for joined tables.
            // Ideally we rely on IDs or use RLS. 
            // For now, we will assume basic fetching and client side filtering if the complex query fails,
            // BUT the prompt requested Server Side.
            // Correct PostgREST syntax for nested filter: books.title.ilike

            if (search) {
                query = query.or(`title.ilike.%${search}%,author.ilike.%${search}%`, { foreignTable: 'books' });
            }

            if (category && category !== "All") {
                query = query.eq('books.category', category);
            }

            query = query.range(page * limit, (page + 1) * limit - 1);

            const { data, error } = await query;

            if (error) throw error;
            const savedBooks = data?.map(d => d.book).filter(Boolean) as Book[] || [];
            // Hide demo/seed books (non-destructive, reversible)
            return filterSeedBooks(savedBooks);
        },
        enabled: !!user?.id,
    });
};

export const useBook = (bookId?: string) => {
    const queryClient = useQueryClient();

    // Realtime: subscribe to this exact book row + its channel row for instant updates
    useEffect(() => {
        if (!bookId) return;

        const channel = supabase
            .channel(`book-detail-rt-${bookId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'books', filter: `id=eq.${bookId}` },
                () => {
                    queryClient.invalidateQueries({ queryKey: ['books', 'detail', bookId] });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [bookId, queryClient]);

    const query = useQuery({
        queryKey: ["books", "detail", bookId],
        queryFn: async () => {
            if (!bookId) return null;

            const { data, error } = await supabase
                .from("books")
                .select(`
          ${BOOK_PUBLIC_COLUMNS},
          channel:channels!books_channel_id_fkey(id, name, avatar_url, user_id, subscribers_count)
        `)
                .eq("id", bookId)
                .single();

            if (error) throw error;
            return data;
        },
        enabled: !!bookId,
        staleTime: 0, // always fresh — realtime handles updates
    });

    // After book loads, also subscribe to channel row so subscriber_count stays live
    const channelId = (query.data as any)?.channel?.id;
    const invalidateBook = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['books', 'detail', bookId] });
    }, [bookId, queryClient]);

    useEffect(() => {
        if (!channelId) return;

        const ch = supabase
            .channel(`channel-rt-${channelId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'channels', filter: `id=eq.${channelId}` },
                invalidateBook
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'subscriptions', filter: `channel_id=eq.${channelId}` },
                invalidateBook
            )
            .subscribe();

        return () => {
            supabase.removeChannel(ch);
        };
    }, [channelId, invalidateBook]);

    return query;
};

/**
 * Returns the list of book-type channels the current user is subscribed to.
 * Realtime: invalidates when subscriptions change.
 */
export const useSubscribedBookChannels = () => {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!user?.id) return;
        const ch = supabase
            .channel(`subscribed-book-channels-rt-${user.id}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'subscriptions', filter: `user_id=eq.${user.id}` },
                () => {
                    queryClient.invalidateQueries({ queryKey: ["subscribed-book-channels", user.id] });
                }
            )
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [user?.id, queryClient]);

    return useQuery({
        queryKey: ["subscribed-book-channels", user?.id],
        queryFn: async () => {
            if (!user?.id) return [];
            const { data, error } = await (supabase as any)
                .from("subscriptions")
                .select(`
                    channel_id,
                    channels:channel_id!inner (
                        id,
                        name,
                        avatar_url,
                        banner_url,
                        description,
                        subscribers_count,
                        channel_type
                    )
                `)
                .eq("user_id", user.id)
                .eq("channels.channel_type", "books");

            if (error) throw error;
            return (data || []).map((row: any) => row.channels).filter(Boolean);
        },
        enabled: !!user?.id,
    });
};
