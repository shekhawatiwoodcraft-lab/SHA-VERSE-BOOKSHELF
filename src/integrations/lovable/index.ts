import { isSupabaseConfigured, supabase } from "../supabase/client";
import { BACKEND_DISCONNECTED_MESSAGE } from "../supabase/disconnectedClient";

type SignInOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};

export const lovable = {
  auth: {
    signInWithOAuth: async (provider: "google" | "apple" | "microsoft" | "lovable", opts?: SignInOptions) => {
      if (!isSupabaseConfigured) {
        return { redirected: false as const, error: new Error(BACKEND_DISCONNECTED_MESSAGE) };
      }

      if (provider === "lovable") {
        return {
          redirected: false as const,
          error: new Error("Legacy Lovable auth is disconnected. Use Email or Google sign-in."),
        };
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: provider === "microsoft" ? "azure" : provider,
        options: {
          redirectTo: opts?.redirect_uri || (typeof window !== "undefined" ? `${window.location.origin}/` : undefined),
          queryParams: opts?.extraParams,
        },
      });

      if (error) {
        return { redirected: false as const, error };
      }

      return { redirected: Boolean(data?.url), url: data?.url };
    },
  },
};
