export type SignUpOutcome =
  | "signed_in"
  | "needs_email_confirmation"
  | "already_registered_unconfirmed";

export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function classifySignUpOutcome(data: {
  user?: { identities?: unknown[] | null } | null;
  session?: unknown | null;
}): SignUpOutcome {
  if (data.session) {
    return "signed_in";
  }
  if (
    data.user &&
    Array.isArray(data.user.identities) &&
    data.user.identities.length === 0
  ) {
    return "already_registered_unconfirmed";
  }
  return "needs_email_confirmation";
}

export interface FormattedAuthError {
  message: string;
  isEmailNotConfirmed: boolean;
  isInvalidCredentials: boolean;
  isRateLimited: boolean;
}

export function formatAuthErrorMessage(error: unknown): FormattedAuthError {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: unknown }).message || "")
        : String(error || "Authentication failed");

  const lower = raw.toLowerCase();

  if (lower.includes("email not confirmed")) {
    return {
      message:
        "Email verify nahi hui hai. Apna inbox/Spam folder check karein aur verification link par click karein, ya neeche 'Resend Verification Email' dabayein.",
      isEmailNotConfirmed: true,
      isInvalidCredentials: false,
      isRateLimited: false,
    };
  }

  if (lower.includes("invalid login credentials")) {
    return {
      message:
        "Email ya password galat hai. Agar yeh nayi ID hai aur pehle Sign Up nahi kiya, to neeche 'Sign up' par click karke naya account banayein.",
      isEmailNotConfirmed: false,
      isInvalidCredentials: true,
      isRateLimited: false,
    };
  }

  if (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("email rate limit exceeded")
  ) {
    return {
      message:
        "Email bhejne ki limit poori ho gayi hai (Supabase free tier limit). Thodi der baad try karein ya Supabase Dashboard → Authentication → Providers → Email me 'Confirm email' OFF karein.",
      isEmailNotConfirmed: false,
      isInvalidCredentials: false,
      isRateLimited: true,
    };
  }

  if (lower.includes("user already registered") || lower.includes("already exists")) {
    return {
      message:
        "Yeh email pehle se registered hai. 'Sign in' par click karke login karein.",
      isEmailNotConfirmed: false,
      isInvalidCredentials: false,
      isRateLimited: false,
    };
  }

  if (lower.includes("unsupported provider") || lower.includes("provider is not enabled")) {
    return {
      message:
        "Google Sign-In abhi Supabase me save nahi hua hai. Supabase Dashboard → Authentication → Providers → Google me Client ID aur Client Secret paste karke Save karein.",
      isEmailNotConfirmed: false,
      isInvalidCredentials: false,
      isRateLimited: false,
    };
  }

  return {
    message: raw || "Authentication failed",
    isEmailNotConfirmed: false,
    isInvalidCredentials: false,
    isRateLimited: false,
  };
}

export function extractOAuthErrorFromLocation(
  search: string,
  hash: string
): string | null {
  const searchParams = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const cleanHash = hash.replace(/^#/, "");
  const hashParams = new URLSearchParams(cleanHash);

  const errorDesc =
    searchParams.get("error_description") || hashParams.get("error_description");
  const errorCode = searchParams.get("error") || hashParams.get("error");

  if (!errorDesc && !errorCode) return null;

  const combined = decodeURIComponent(
    (errorDesc || errorCode || "").replace(/\+/g, " ")
  ).trim();

  if (!combined) return null;

  if (/access_denied/i.test(errorCode || "") || /access_denied/i.test(combined)) {
    return "Google Sign-In cancel ya block hua (Access Denied). Agar yeh nayi Google ID hai to Google Cloud → OAuth Audience me 'Publish App' karein.";
  }

  return combined;
}
