import ePub from "epubjs";
import { get, set } from "idb-keyval";
import type { Block, Chapter, ReflowBook } from "@/lib/reader/types";
import { REFLOW_MODEL_VERSION } from "@/lib/reader/types";
import { normalizeReaderText } from "@/lib/reader/sanitize";

const EPUB_REFLOW_PREFIX = "shaverse:epub-reflow:v1:";

/**
 * Extracts a structured ReflowBook from an EPUB file on demand so EPUB titles
 * support AI translation (all 4 reading modes) and synchronized TTS narration
 * without disrupting EPUBViewer's native rendition.
 */
export async function extractEpubReflow(params: {
  bookId: string;
  url: string;
  title?: string;
  author?: string;
}): Promise<ReflowBook> {
  const { bookId, url, title, author } = params;
  const cacheKey = `${EPUB_REFLOW_PREFIX}${bookId}`;

  try {
    const cached = await get<{ url: string; book: ReflowBook }>(cacheKey);
    if (cached?.url === url && cached.book?.blocks?.length > 0) {
      return cached.book;
    }
  } catch {
    /* ignore cache read error */
  }

  const book = ePub(url);
  try {
    await book.ready;
    const spine = await book.loaded.spine;
    const nav = await book.loaded.navigation;
    const metadata = await book.loaded.metadata;

    const spineItems: Array<{ href: string; index?: number; load: (r: unknown) => Promise<Document> }> =
      (spine as unknown as { spineItems?: Array<{ href: string; index?: number; load: (r: unknown) => Promise<Document> }> })
        ?.spineItems ?? [];

    const tocLabels = new Map<string, string>();
    const collectToc = (items: Array<{ label?: string; href?: string; subitems?: unknown[] }>) => {
      for (const item of items) {
        if (item.href && item.label) {
          const cleanHref = item.href.split("#")[0];
          tocLabels.set(cleanHref, item.label.trim());
        }
        if (Array.isArray(item.subitems)) {
          collectToc(item.subitems as Array<{ label?: string; href?: string; subitems?: unknown[] }>);
        }
      }
    };
    if (Array.isArray(nav?.toc)) {
      collectToc(nav.toc as Array<{ label?: string; href?: string; subitems?: unknown[] }>);
    }

    const blocks: Block[] = [];
    const chapters: Chapter[] = [];
    let blockCounter = 0;
    let sectionNumber = 0;

    for (const item of spineItems) {
      sectionNumber += 1;
      const cleanHref = (item.href || "").split("#")[0];
      let chapterTitle = tocLabels.get(cleanHref) || "";

      try {
        const doc = await item.load(book.load.bind(book));
        if (!doc) continue;

        const root = (doc as Document).body || (doc as Document).documentElement;
        if (!root) continue;

        const startBlockIdx = blocks.length;
        const elements = root.querySelectorAll("h1, h2, h3, h4, p, blockquote, li");
        const seenTexts = new Set<string>();

        if (elements.length > 0) {
          elements.forEach((el) => {
            const tag = el.tagName.toLowerCase();
            // Skip nested paragraphs/divs already covered
            if (tag === "li" && el.querySelector("p")) return;
            const rawText = normalizeReaderText((el.textContent || "").replace(/\s+/g, " ").trim());
            if (!rawText || rawText.length < 2) return;
            if (seenTexts.has(rawText) && rawText.length < 40) return;
            seenTexts.add(rawText);

            if (/^h[1-4]$/.test(tag)) {
              const level = tag === "h1" ? 1 : tag === "h2" ? 2 : 3;
              if (!chapterTitle) chapterTitle = rawText.slice(0, 80);
              blocks.push({
                id: `ep_${sectionNumber}_${blockCounter++}`,
                page: sectionNumber,
                type: "heading",
                level,
                text: rawText,
                dir: /[\u0600-\u06FF\u0590-\u05FF]/.test(rawText) ? "rtl" : "ltr",
              });
            } else {
              blocks.push({
                id: `ep_${sectionNumber}_${blockCounter++}`,
                page: sectionNumber,
                type: "paragraph",
                text: rawText,
                dir: /[\u0600-\u06FF\u0590-\u05FF]/.test(rawText) ? "rtl" : "ltr",
                quote: tag === "blockquote",
              });
            }
          });
        } else {
          const fallbackText = normalizeReaderText((root.textContent || "").replace(/\s+/g, " ").trim());
          if (fallbackText) {
            blocks.push({
              id: `ep_${sectionNumber}_${blockCounter++}`,
              page: sectionNumber,
              type: "paragraph",
              text: fallbackText,
              dir: /[\u0600-\u06FF\u0590-\u05FF]/.test(fallbackText) ? "rtl" : "ltr",
            });
          }
        }

        if (blocks.length > startBlockIdx) {
          chapters.push({
            id: `ep_ch_${sectionNumber}`,
            title: chapterTitle || `Chapter ${chapters.length + 1}`,
            blockIndex: startBlockIdx,
            page: sectionNumber,
            level: 0,
          });
        }
      } catch {
        // Continue past malformed spine item without aborting extraction
      }
    }

    const langCode = (metadata as { language?: string })?.language?.split(/[-_]/)[0] || "en";
    const isRtl = langCode === "ar" || langCode === "ur" || langCode === "he" || langCode === "fa";

    const result: ReflowBook = {
      version: REFLOW_MODEL_VERSION,
      bookId,
      meta: {
        title: title || (metadata as { title?: string })?.title || "Untitled",
        author: author || (metadata as { creator?: string })?.creator || undefined,
        language: langCode,
        totalPages: Math.max(1, chapters.length || spineItems.length || 1),
        scanned: false,
        dir: isRtl ? "rtl" : "ltr",
      },
      blocks,
      chapters,
    };

    if (blocks.length > 0) {
      try {
        await set(cacheKey, { url, book: result });
      } catch {
        /* ignore cache write failure */
      }
    }

    return result;
  } finally {
    try {
      book.destroy();
    } catch {
      /* ignore */
    }
  }
}
