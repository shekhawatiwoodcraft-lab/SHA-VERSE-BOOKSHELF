/**
 * Deep-link helper — single source of truth for Bookshelf entity URLs.
 */

export type ShareEntityType = 'book' | 'channel';

export const getEntityPath = (type: ShareEntityType, id: string): string => {
  switch (type) {
    case 'channel':
      return `/bookshelf/channel/${id}`;
    case 'book':
    default:
      return `/bookshelf/book/${id}`;
  }
};

export const getEntityUrl = (type: ShareEntityType, id: string): string => {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';
  return `${origin}${getEntityPath(type, id)}`;
};

export const handleShare = async (
  type: ShareEntityType,
  id: string,
  title?: string,
  text?: string
): Promise<'shared' | 'copied' | 'failed'> => {
  const url = getEntityUrl(type, id);
  const shareTitle = title || 'SHA-VERSE';
  const shareText = text || 'Check this out on SHA-VERSE';

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: shareTitle, text: shareText, url });
      return 'shared';
    } catch (err: any) {
      if (err?.name === 'AbortError') return 'failed';
    }
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return 'copied';
    }
  } catch {
    /* ignore */
  }

  return 'failed';
};
