import { useEffect, useCallback, useId } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { compressImage } from '@/lib/media/compressImage';
import { computeExpiresAt, isStatusActive } from '@/lib/promotions/statusDuration';
import { isSchemaMissingError } from '@/integrations/supabase/config';
import { APP_OWNER_EMAIL, isOwnerEmail } from '@/modules/bookshelf/lib/uploadAccess';
import { useAppOwner } from '@/hooks/useAppOwner';

export interface AppPromotion {
  id: string;
  owner_id: string;
  media_url: string;
  media_type: 'image' | 'video' | 'text';
  text_content: string | null;
  background_color: string | null;
  caption: string | null;
  link_url: string | null;
  views_count: number;
  created_at: string;
  expires_at: string;
}

export interface CreatePromotionBatchInput {
  files?: File[];
  textContent?: string;
  backgroundColor?: string;
  caption?: string;
  linkUrl?: string;
  durationMs: number;
}

const MAX_UPLOAD_BUCKETS = ['avatars', 'books'] as const;

async function uploadStatusMedia(userId: string, file: File, index: number): Promise<{ url: string; mediaType: 'image' | 'video' }> {
  const isVideo = file.type.startsWith('video/');
  const processedFile = isVideo ? file : await compressImage(file);
  const safeName = processedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${userId}/promotions/${Date.now()}_${index}_${safeName}`;

  let lastError: Error | null = null;
  for (const bucket of MAX_UPLOAD_BUCKETS) {
    const { error } = await supabase.storage.from(bucket).upload(path, processedFile, {
      contentType: processedFile.type || undefined,
      upsert: false,
    });
    if (!error) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return { url: data.publicUrl, mediaType: isVideo ? 'video' : 'image' };
    }
    lastError = error;
  }

  throw lastError ?? new Error('Failed to upload status media');
}

export { APP_OWNER_EMAIL, isOwnerEmail };

const viewsStorageKey = (userId?: string) =>
  userId ? `sha_verse_promo_views_${userId}` : 'sha_verse_promo_views_guest';

function readLocalViewedIds(userId?: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(viewsStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeLocalViewedId(userId: string | undefined, promotionId: string) {
  if (typeof window === 'undefined') return;
  try {
    const existing = new Set(readLocalViewedIds(userId));
    existing.add(promotionId);
    window.localStorage.setItem(viewsStorageKey(userId), JSON.stringify(Array.from(existing).slice(-200)));
  } catch {
    // Ignore storage quota errors
  }
}

export function useAppPromotions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { isAppOwner } = useAppOwner();

  // Fetch currently active (non-expired) status updates in chronological order
  const { data: promotions = [], isLoading } = useQuery({
    queryKey: ['app-promotions'],
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('app_promotions')
        .select('*')
        .gt('expires_at', nowIso)
        .order('created_at', { ascending: true });

      if (error) {
        if (isSchemaMissingError(error)) return [];
        throw error;
      }
      return (data ?? []) as AppPromotion[];
    },
    staleTime: 1000 * 30,
  });

  const viewsQueryKey = ['app-promotion-views', user?.id ?? 'guest'] as const;

  // Fetch which promotions current user has already seen (DB + per-user local cache)
  const { data: viewedIds = new Set<string>() } = useQuery({
    queryKey: viewsQueryKey,
    queryFn: async () => {
      const localViewed = readLocalViewedIds(user?.id);
      if (!user) return new Set<string>(localViewed);

      const { data, error } = await supabase
        .from('app_promotion_views')
        .select('promotion_id')
        .eq('viewer_id', user.id);

      if (error) return new Set<string>(localViewed);
      return new Set<string>([
        ...localViewed,
        ...(data ?? []).map((row) => row.promotion_id),
      ]);
    },
    staleTime: 1000 * 30,
  });

  // Auto-remove expired status updates the moment their expires_at time arrives
  useEffect(() => {
    if (!promotions.length) return;

    const purgeExpired = async () => {
      const nowMs = Date.now();
      const currentIso = new Date(nowMs).toISOString();
      const hasExpired = promotions.some((p) => !isStatusActive(p.expires_at, nowMs));
      if (!hasExpired) return;

      queryClient.setQueryData<AppPromotion[]>(['app-promotions'], (prev) =>
        (prev ?? []).filter((p) => isStatusActive(p.expires_at, nowMs)),
      );
      queryClient.invalidateQueries({ queryKey: ['app-promotions'] });

      if (isAppOwner && user) {
        try {
          await supabase
            .from('app_promotions')
            .delete()
            .eq('owner_id', user.id)
            .lte('expires_at', currentIso);
        } catch {
          // Best-effort cleanup of expired owner stories
        }
      }
    };

    const now = Date.now();
    let earliestRemainingMs = Infinity;

    for (const promo of promotions) {
      const remaining = new Date(promo.expires_at).getTime() - now;
      if (remaining < earliestRemainingMs) {
        earliestRemainingMs = remaining;
      }
    }

    const delay = Math.max(0, Math.min(earliestRemainingMs + 25, 2147483647));
    const timer = window.setTimeout(() => {
      void purgeExpired();
    }, delay);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void purgeExpired();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [promotions, isAppOwner, user, queryClient]);

  const rtId = useId();

  // Real-time updates when owner posts or removes stories
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`app-promotions-live-${rtId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_promotions' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['app-promotions'] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, rtId, queryClient]);

  const createPromotions = useMutation({
    mutationFn: async (input: CreatePromotionBatchInput) => {
      if (!user) throw new Error('Please sign in first');
      if (!isAppOwner) throw new Error('Only the app owner can post status updates');

      const expiresAt = computeExpiresAt(input.durationMs);
      const cleanCaption = input.caption?.trim() || null;
      const cleanLink = input.linkUrl?.trim() || null;

      if (input.files && input.files.length > 0) {
        const rows = [];
        for (let i = 0; i < input.files.length; i++) {
          const uploaded = await uploadStatusMedia(user.id, input.files[i], i);
          rows.push({
            owner_id: user.id,
            media_url: uploaded.url,
            media_type: uploaded.mediaType,
            caption: cleanCaption,
            link_url: cleanLink,
            expires_at: expiresAt,
          });
        }

        const { data, error } = await supabase
          .from('app_promotions')
          .insert(rows)
          .select();

        if (error) throw error;
        return (data ?? []) as AppPromotion[];
      }

      const text = input.textContent?.trim();
      if (!text) throw new Error('Please add text or select at least one image');

      const { data, error } = await supabase
        .from('app_promotions')
        .insert({
          owner_id: user.id,
          media_url: '',
          media_type: 'text',
          text_content: text,
          background_color: input.backgroundColor || 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
          caption: cleanCaption,
          link_url: cleanLink,
          expires_at: expiresAt,
        })
        .select();

      if (error) throw error;
      return (data ?? []) as AppPromotion[];
    },
    onSuccess: (createdRows) => {
      if (createdRows.length > 0) {
        queryClient.setQueryData<AppPromotion[]>(['app-promotions'], (prev) => {
          const existing = (prev ?? []).filter((p) => isStatusActive(p.expires_at));
          const existingIds = new Set(existing.map((p) => p.id));
          const merged = [...existing];
          for (const row of createdRows) {
            if (isStatusActive(row.expires_at) && !existingIds.has(row.id)) {
              merged.push(row);
            }
          }
          return merged.sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          );
        });
      }
      queryClient.invalidateQueries({ queryKey: ['app-promotions'] });
    },
  });

  const deletePromotion = useMutation({
    mutationFn: async (promotionId: string) => {
      if (!user || !isAppOwner) throw new Error('Unauthorized');
      const { error } = await supabase
        .from('app_promotions')
        .delete()
        .eq('id', promotionId);

      if (error) throw error;
      return promotionId;
    },
    onSuccess: (deletedId) => {
      queryClient.setQueryData<AppPromotion[]>(['app-promotions'], (prev) =>
        (prev ?? []).filter((p) => p.id !== deletedId),
      );
      queryClient.invalidateQueries({ queryKey: ['app-promotions'] });
    },
  });

  const markViewed = useCallback(
    async (promotionId: string) => {
      if (viewedIds.has(promotionId)) return;

      writeLocalViewedId(user?.id, promotionId);
      queryClient.setQueryData<Set<string>>(['app-promotion-views', user?.id ?? 'guest'], (prev) => {
        const next = new Set(prev ?? readLocalViewedIds(user?.id));
        next.add(promotionId);
        return next;
      });

      if (!user) return;

      try {
        const { error } = await supabase.from('app_promotion_views').insert({
          promotion_id: promotionId,
          viewer_id: user.id,
        });
        if (!error) {
          const target = promotions.find((p) => p.id === promotionId);
          if (target) {
            await supabase
              .from('app_promotions')
              .update({ views_count: (target.views_count || 0) + 1 })
              .eq('id', promotionId);
          }
        }
      } catch {
        // Ignore duplicate view inserts
      }
    },
    [user, viewedIds, promotions, queryClient],
  );

  const activePromotions = promotions.filter((p) => isStatusActive(p.expires_at));
  const hasActive = activePromotions.length > 0;
  const hasUnviewed = activePromotions.some((p) => !viewedIds.has(p.id));

  return {
    promotions: activePromotions,
    viewedIds,
    isLoading,
    isAppOwner,
    hasActive,
    hasUnviewed,
    createPromotions,
    deletePromotion,
    markViewed,
  };
}
