export const APP_OWNER_EMAIL = "shashaaiteam@gmail.com";

export type UploadMode = "single" | "bulk";

export function isOwnerEmail(email?: string | null): boolean {
  return (email ?? "").trim().toLowerCase() === APP_OWNER_EMAIL;
}

/**
 * Pure access guard: only the app owner (owner email or admin role) can access bulk upload.
 * Regular users are strictly locked to "single" upload mode.
 */
export function resolveEffectiveUploadMode(
  requestedMode: UploadMode,
  isAppOwner: boolean,
): UploadMode {
  if (!isAppOwner) return "single";
  return requestedMode === "bulk" ? "bulk" : "single";
}
