import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { AdCategory } from "@/lib/ads/adTypes";

/**
 * Returns the most likely ad category for the current user based on
 * their recent Bookshelf reading activity. Falls back to 'general'.
 */
export function useAdTargeting(): { category: AdCategory } {
  const { user } = useAuth();
  const [category, setCategory] = useState<AdCategory>("general");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

        const [readingRes, subsRes] = await Promise.all([
          supabase
            .from("book_reading_progress")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .gte("last_read_at", sevenDaysAgo),
          supabase
            .from("subscriptions" as any)
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id),
        ]);

        if (cancelled) return;

        if ((readingRes.count || 0) > 0 || (subsRes.count || 0) > 0) {
          setCategory("education");
        }
      } catch {
        // Silent fallback
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  return { category };
}
