/**
 * Extracts the storage object path inside a given Supabase public/signed storage URL.
 * Returns null for non-matching or external URLs.
 */
export function extractStorageObjectPath(
  fileUrl: string | null | undefined,
  bucketName: string,
): string | null {
  if (!fileUrl || !bucketName) return null;
  const trimmed = fileUrl.trim();
  if (!trimmed) return null;

  const escapedBucket = bucketName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`/storage/v1/object/public/${escapedBucket}/([^?#]+)`),
    new RegExp(`/storage/v1/object/sign/${escapedBucket}/([^?#]+)`),
    new RegExp(`/storage/v1/object/${escapedBucket}/([^?#]+)`),
  ];

  for (const re of patterns) {
    const match = re.exec(trimmed);
    if (match?.[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
  }

  return null;
}

/**
 * Pure guard ensuring permanent deletion only runs when the user explicitly
 * checked the confirmation box and a valid bookId is present.
 */
export function canConfirmPermanentBookDelete(params: {
  bookId?: string | null;
  confirmed: boolean;
  isDeleting?: boolean;
}): boolean {
  return Boolean(params.bookId && params.bookId.trim().length > 0 && params.confirmed && !params.isDeleting);
}
