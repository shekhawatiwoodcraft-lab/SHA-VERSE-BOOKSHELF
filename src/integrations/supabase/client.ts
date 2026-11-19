import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { brokeredPreviewStorage } from './previewAuthStorage';
import { createDisconnectedSupabaseClient } from './disconnectedClient';
import { resolveSupabaseConfig } from './config';

export const SUPABASE_ENABLED = true;

const { url: resolvedUrl, publishableKey: resolvedKey, projectRef: activeProjectRef } =
  resolveSupabaseConfig({
    url: import.meta.env.VITE_SUPABASE_URL,
    key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  });

export const SUPABASE_URL = SUPABASE_ENABLED ? resolvedUrl : "";
export const SUPABASE_PUBLISHABLE_KEY = SUPABASE_ENABLED ? resolvedKey : "";

export const isSupabaseConfigured = Boolean(SUPABASE_ENABLED && SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

// Clean up any leftover auth tokens from previously connected or legacy Supabase projects.
if (typeof window !== "undefined") {
  try {
    const activePrefix = activeProjectRef ? `sb-${activeProjectRef}-auth-token` : "";
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      const isSbToken = /^sb-[a-z0-9-]+-auth-token/i.test(k);
      if (isSbToken && (!isSupabaseConfigured || (activePrefix && !k.startsWith(activePrefix)))) {
        window.localStorage.removeItem(k);
      }
    }
  } catch {
    // Ignore storage access errors
  }
}

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = isSupabaseConfigured
  ? createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storage: brokeredPreviewStorage(),
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : (createDisconnectedSupabaseClient() as unknown as ReturnType<typeof createClient<Database>>);