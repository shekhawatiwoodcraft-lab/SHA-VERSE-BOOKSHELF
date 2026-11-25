const MIME_TO_EXT: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/heic": "heic",
  "image/heif": "heif",
};

export interface SafeImageUploadMeta {
  ext: string;
  contentType: string;
}

/**
 * Resolves a safe file extension and MIME type even when mobile WebView
 * photo pickers return filenames without an extension (e.g. "image").
 */
export function resolveSafeImageUploadMeta(file: Pick<File, "name" | "type">): SafeImageUploadMeta {
  const normalizedType = (file.type || "").toLowerCase().trim();
  const mimeExt = MIME_TO_EXT[normalizedType];
  if (mimeExt) {
    return { ext: mimeExt, contentType: normalizedType };
  }

  const nameParts = (file.name || "").split(".");
  const rawExt = nameParts.length > 1 ? nameParts.pop()?.toLowerCase().trim() : "";
  const safeExt = rawExt && /^[a-z0-9]{2,5}$/.test(rawExt) ? rawExt : "jpg";
  const fallbackContentType =
    safeExt === "png"
      ? "image/png"
      : safeExt === "webp"
        ? "image/webp"
        : safeExt === "gif"
          ? "image/gif"
          : "image/jpeg";

  return {
    ext: safeExt,
    contentType: normalizedType.startsWith("image/") ? normalizedType : fallbackContentType,
  };
}
