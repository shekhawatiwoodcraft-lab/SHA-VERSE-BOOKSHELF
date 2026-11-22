import type { Block, Chapter, ReflowBook } from "@/lib/reader/types";

export interface SentenceSpan {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface AudioSegment {
  id: string;
  bookId: string;
  chapterId: string;
  chapterTitle: string;
  blockId: string;
  blockIndex: number;
  sentenceIndex: number;
  sentenceCount: number;
  charStart?: number;
  charEnd?: number;
  page: number;
  text: string;
  language: string;
  voiceId: string;
  style: string;
  contentHash: string;
  hasDialogue: boolean;
}

export interface DialogueTurn {
  speaker: "Narrator" | "Speaker";
  text: string;
}

/**
 * Strips optional markdown code fences around JSON responses from LLM providers
 * before parsing.
 */
export function parseModelJson<T>(rawText: string): T {
  const cleaned = String(rawText || "{}")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned || "{}") as T;
}

const ABBREVIATION_RE =
  /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|No|Vol|Ch|Fig|approx)\.\s*$/i;

/**
 * Deterministic lightweight FNV-1a 64-bit hex hash (pure JS, browser + Node safe)
 * used for stable audio/translation cache invalidation keys.
 */
export function hashTextContent(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Splits a paragraph cleanly into sentence spans while protecting common English
 * abbreviations and decimal numbers, and supporting Latin, Devanagari (।),
 * Arabic/Urdu (۔ ؟), and CJK (。！？) sentence boundaries.
 */
export function splitIntoSentences(rawText: string): SentenceSpan[] {
  const text = rawText;
  if (!text || !text.trim()) return [];

  const spans: SentenceSpan[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const isEndPunct =
      ch === "." ||
      ch === "!" ||
      ch === "?" ||
      ch === "।" ||
      ch === "॥" ||
      ch === "۔" ||
      ch === "؟" ||
      ch === "。" ||
      ch === "！" ||
      ch === "？";

    if (!isEndPunct) continue;

    // Skip ellipsis runs & decimals like 3.14
    if (ch === ".") {
      const prev = text[i - 1] || "";
      const next = text[i + 1] || "";
      if (/\d/.test(prev) && /\d/.test(next)) continue;
      if (next === ".") continue;
    }

    // Consume trailing closing quotes/brackets after punctuation
    let end = i + 1;
    while (end < text.length && /["'”’)\]\u00bb]/.test(text[end])) {
      end += 1;
    }

    // Ensure next non-space exists or we're at end; check abbreviations
    const slice = text.slice(start, end);
    if (ch === "." && ABBREVIATION_RE.test(slice)) {
      continue;
    }

    const nextChar = text[end];
    const isCjkOrIndicBreak = ch === "。" || ch === "！" || ch === "？" || ch === "।" || ch === "॥";
    if (end < text.length && !isCjkOrIndicBreak && nextChar && !/\s/.test(nextChar)) {
      continue;
    }

    const trimmed = slice.trim();
    if (trimmed.length > 0) {
      const leadingWs = slice.length - slice.trimStart().length;
      const trailingWs = slice.length - slice.trimEnd().length;
      spans.push({
        index: spans.length,
        start: start + leadingWs,
        end: end - trailingWs,
        text: trimmed,
      });
    }

    while (end < text.length && /\s/.test(text[end])) {
      end += 1;
    }
    start = end;
    i = Math.max(i, end - 1);
  }

  if (start < text.length) {
    const tail = text.slice(start);
    const trimmed = tail.trim();
    if (trimmed.length > 0) {
      const leadingWs = tail.length - tail.trimStart().length;
      const trailingWs = tail.length - tail.trimEnd().length;
      spans.push({
        index: spans.length,
        start: start + leadingWs,
        end: text.length - trailingWs,
        text: trimmed,
      });
    }
  }

  return spans;
}

/**
 * Conservatively splits quoted dialogue from surrounding narration for
 * dual-voice playback. Only activates when an explicit quoted utterance >= 8 chars exists.
 */
export function detectDialogueParts(text: string): DialogueTurn[] {
  const quoteRe = /(["“«「『])([^"”»」』]{8,})(["”»」』])/g;
  const parts: DialogueTurn[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = quoteRe.exec(text)) !== null) {
    const before = text.slice(cursor, match.index).trim();
    if (before) {
      parts.push({ speaker: "Narrator", text: before });
    }
    const quoteText = `${match[1]}${match[2]}${match[3]}`.trim();
    if (quoteText) {
      parts.push({ speaker: "Speaker", text: quoteText });
    }
    cursor = match.index + match[0].length;
  }

  const after = text.slice(cursor).trim();
  if (after) {
    parts.push({ speaker: "Narrator", text: after });
  }

  if (!parts.some((p) => p.speaker === "Speaker")) {
    return [{ speaker: "Narrator", text: text.trim() }];
  }
  return parts;
}

/** Resolves chapters robustly even when a short PDF had no extracted outline. */
export function resolveBookChapters(book: ReflowBook): Chapter[] {
  if (book.chapters && book.chapters.length > 0) {
    return book.chapters;
  }
  if (!book.blocks.length) return [];

  // Fallback: synthesize logical sections every ~15 blocks or per page group
  const fallback: Chapter[] = [];
  const step = 18;
  for (let i = 0; i < book.blocks.length; i += step) {
    const b = book.blocks[i];
    if (!b || b.type === "pagebreak") continue;
    fallback.push({
      id: `section_${fallback.length + 1}`,
      title: fallback.length === 0 ? (book.meta.title || "Opening Section") : `Section ${fallback.length + 1} (Page ${b.page})`,
      blockIndex: i,
      page: b.page,
      level: 0,
    });
  }
  return fallback.length
    ? fallback
    : [{ id: "section_1", title: book.meta.title || "Full Book", blockIndex: 0, page: 1, level: 0 }];
}

export function getChapterBlockRange(
  book: ReflowBook,
  chapterIndex: number,
): { chapter: Chapter; startIndex: number; endIndex: number } | null {
  const chapters = resolveBookChapters(book);
  const chapter = chapters[chapterIndex];
  if (!chapter) return null;
  const startIndex = Math.max(0, chapter.blockIndex);
  const nextChapter = chapters[chapterIndex + 1];
  const endIndex = nextChapter ? Math.max(startIndex, nextChapter.blockIndex) : book.blocks.length;
  return { chapter, startIndex, endIndex };
}

/**
 * Generates audio segments for a chapter (or translated chapter blocks).
 * - mode="sentence" (default): 1 segment per sentence.
 * - mode="paragraph": 1 cohesive segment per paragraph (up to maxCharsPerSegment chars),
 *   dramatically reducing TTS API round-trips and eliminating inter-sentence gaps.
 */
export function buildChapterAudioSegments(params: {
  bookId: string;
  chapter: Chapter;
  blocks: Block[];
  startIndex: number;
  endIndex: number;
  language: string;
  voiceId: string;
  style: string;
  translatedMap?: Record<string, string>;
  mode?: "sentence" | "paragraph";
  maxCharsPerSegment?: number;
}): AudioSegment[] {
  const {
    bookId,
    chapter,
    blocks,
    startIndex,
    endIndex,
    language,
    voiceId,
    style,
    translatedMap,
    mode = "sentence",
    maxCharsPerSegment = 850,
  } = params;

  const segments: AudioSegment[] = [];
  for (let bi = startIndex; bi < Math.min(endIndex, blocks.length); bi++) {
    const block = blocks[bi];
    if (!block) continue;
    if (block.type !== "heading" && block.type !== "paragraph") continue;

    const rawText = translatedMap?.[block.id] ?? block.text;
    const trimmed = rawText?.trim();
    if (!trimmed) continue;

    const sentences = splitIntoSentences(trimmed);
    const baseSpans = sentences.length
      ? sentences
      : [{ index: 0, start: 0, end: trimmed.length, text: trimmed }];

    let chunkList: Array<{ index: number; start: number; end: number; text: string }>;
    if (mode === "paragraph") {
      if (trimmed.length <= maxCharsPerSegment) {
        chunkList = [
          {
            index: baseSpans.length <= 1 ? 0 : -1,
            start: 0,
            end: trimmed.length,
            text: trimmed,
          },
        ];
      } else {
        chunkList = [];
        let accTexts: string[] = [];
        let accStart = baseSpans[0].start;
        let accEnd = baseSpans[0].end;
        let accLen = 0;

        for (const s of baseSpans) {
          const addedLen = (accTexts.length > 0 ? 1 : 0) + s.text.length;
          if (accTexts.length > 0 && accLen + addedLen > maxCharsPerSegment) {
            chunkList.push({
              index: chunkList.length,
              start: accStart,
              end: accEnd,
              text: accTexts.join(" "),
            });
            accTexts = [s.text];
            accStart = s.start;
            accEnd = s.end;
            accLen = s.text.length;
          } else {
            if (accTexts.length === 0) accStart = s.start;
            accTexts.push(s.text);
            accEnd = s.end;
            accLen += addedLen;
          }
        }
        if (accTexts.length > 0) {
          chunkList.push({
            index: chunkList.length,
            start: accStart,
            end: accEnd,
            text: accTexts.join(" "),
          });
        }
      }
    } else {
      chunkList = baseSpans;
    }

    for (const s of chunkList) {
      const hasDialogue = detectDialogueParts(s.text).some((p) => p.speaker === "Speaker");
      const contentHash = hashTextContent(
        `${bookId}:${block.id}:${mode}:${s.index}:${language}:${voiceId}:${style}:${s.text}`,
      );
      segments.push({
        id: `${chapter.id}_${block.id}_s${s.index}_${contentHash.slice(0, 8)}`,
        bookId,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        blockId: block.id,
        blockIndex: bi,
        sentenceIndex: s.index,
        sentenceCount: chunkList.length,
        charStart: s.start,
        charEnd: s.end,
        page: block.page,
        text: s.text,
        language,
        voiceId,
        style,
        contentHash,
        hasDialogue,
      });
    }
  }
  return segments;
}

/**
 * Extracts recurring capitalized proper nouns / character names / multi-word terms
 * to preserve consistency across translation batches.
 */
export function extractCandidateGlossaryTerms(blocks: Block[], maxTerms = 24): string[] {
  const counts = new Map<string, number>();
  const stopWords = new Set([
    "The", "This", "That", "These", "Those", "There", "Their", "When", "Where",
    "What", "Which", "While", "After", "Before", "Chapter", "Section", "Part",
    "However", "Although", "Because", "Since", "Until", "From", "With", "Into",
  ]);

  const re = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g;
  for (const b of blocks) {
    if (b.type !== "paragraph" && b.type !== "heading") continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b.text)) !== null) {
      const term = m[1].trim();
      if (stopWords.has(term)) continue;
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([term]) => term);
}

/**
 * Groups blocks into translation batches obeying BOTH block-count and total
 * character-budget limits so long paragraphs never trigger server 400 errors.
 */
export function chunkBlocksByBudget<T extends { id: string; text: string }>(
  blocks: T[],
  maxBlocks = 10,
  maxChars = 16_000,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;

  for (const block of blocks) {
    const len = Math.min(block.text.length, 5800);
    if (
      current.length > 0 &&
      (current.length >= maxBlocks || currentChars + len > maxChars)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(block);
    currentChars += len;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Validates that a translated batch returned by the AI model matches the
 * exact requested block IDs in order, with non-empty translations for non-empty sources.
 */
export function validateTranslationBatch(
  sourceBlocks: Array<{ id: string; text: string }>,
  translatedItems: Array<{ id: string; translatedText: string }>,
): { valid: boolean; map: Record<string, string>; error?: string } {
  if (!Array.isArray(translatedItems)) {
    return { valid: false, map: {}, error: "Invalid translation response format." };
  }
  const byId = new Map<string, string>();
  for (const item of translatedItems) {
    if (!item || typeof item.id !== "string" || typeof item.translatedText !== "string") continue;
    byId.set(item.id.trim(), item.translatedText.trim());
  }

  const map: Record<string, string> = {};
  for (const src of sourceBlocks) {
    const translated = byId.get(src.id.trim());
    if (src.text.trim().length > 0 && (!translated || translated.length === 0)) {
      return {
        valid: false,
        map: {},
        error: `Missing translated text for segment ${src.id}.`,
      };
    }
    map[src.id] = translated ?? src.text;
  }

  return { valid: true, map };
}

export type TextBlock = Extract<Block, { type: "heading" | "paragraph" }>;

/**
 * Collects all translatable/narratable text blocks belonging to a specific page.
 * Falls back gracefully around fallbackStartBlockIndex when a single page has no blocks.
 */
export function getPageTextBlocks(
  book: ReflowBook,
  targetPage: number,
  fallbackStartBlockIndex = 0,
  fallbackCount = 6,
): Array<{ block: TextBlock; blockIndex: number }> {
  const exact: Array<{ block: TextBlock; blockIndex: number }> = [];
  for (let i = 0; i < book.blocks.length; i++) {
    const b = book.blocks[i];
    if ((b.type === "heading" || b.type === "paragraph") && b.page === targetPage && b.text.trim()) {
      exact.push({ block: b, blockIndex: i });
    }
  }
  if (exact.length > 0) return exact;

  const start = Math.max(0, Math.min(fallbackStartBlockIndex, Math.max(0, book.blocks.length - 1)));
  const near: Array<{ block: TextBlock; blockIndex: number }> = [];
  for (let i = start; i < book.blocks.length && near.length < fallbackCount; i++) {
    const b = book.blocks[i];
    if ((b.type === "heading" || b.type === "paragraph") && b.text.trim()) {
      near.push({ block: b, blockIndex: i });
    }
  }
  if (near.length > 0) return near;

  for (let i = 0; i < book.blocks.length && near.length < fallbackCount; i++) {
    const b = book.blocks[i];
    if ((b.type === "heading" || b.type === "paragraph") && b.text.trim()) {
      near.push({ block: b, blockIndex: i });
    }
  }
  return near;
}

/**
 * Builds AudioSegments strictly for the requested reading page (Page Audio level).
 */
export function buildPageAudioSegments(params: {
  bookId: string;
  book: ReflowBook;
  page: number;
  language: string;
  voiceId: string;
  style: string;
  translatedMap?: Record<string, string>;
  fallbackStartBlockIndex?: number;
  maxCharsPerSegment?: number;
}): AudioSegment[] {
  const {
    bookId,
    book,
    page,
    language,
    voiceId,
    style,
    translatedMap,
    fallbackStartBlockIndex = 0,
    maxCharsPerSegment = 850,
  } = params;

  const pageBlocks = getPageTextBlocks(book, page, fallbackStartBlockIndex);
  if (pageBlocks.length === 0) return [];

  const chapters = resolveBookChapters(book);
  const firstBi = pageBlocks[0].blockIndex;
  let ownerChapter = chapters[0] ?? {
    id: `page_${page}`,
    title: `Page ${page}`,
    blockIndex: firstBi,
    page,
    level: 0,
  };
  for (let ci = 0; ci < chapters.length; ci++) {
    if (chapters[ci].blockIndex <= firstBi) ownerChapter = chapters[ci];
    else break;
  }

  const out: AudioSegment[] = [];
  for (const { block, blockIndex } of pageBlocks) {
    const chunkSegs = buildChapterAudioSegments({
      bookId,
      chapter: ownerChapter,
      blocks: book.blocks,
      startIndex: blockIndex,
      endIndex: blockIndex + 1,
      language,
      voiceId,
      style,
      translatedMap,
      mode: "paragraph",
      maxCharsPerSegment,
    });
    out.push(...chunkSegs);
  }
  return out;
}

/**
 * Builds AudioSegments for arbitrary highlighted/selected text (Selected Text Audio level).
 */
export function buildSelectionAudioSegments(params: {
  bookId: string;
  text: string;
  language: string;
  voiceId: string;
  style: string;
  blockId?: string;
  blockIndex?: number;
  chapterId?: string;
  chapterTitle?: string;
  page?: number;
  maxCharsPerSegment?: number;
}): AudioSegment[] {
  const clean = (params.text || "").trim();
  if (!clean) return [];

  const maxChars = params.maxCharsPerSegment ?? 850;
  const sentences = splitIntoSentences(clean);
  const baseSpans = sentences.length
    ? sentences
    : [{ index: 0, start: 0, end: clean.length, text: clean }];

  const chunks: Array<{ index: number; start: number; end: number; text: string }> = [];
  if (clean.length <= maxChars) {
    chunks.push({ index: 0, start: 0, end: clean.length, text: clean });
  } else {
    let accTexts: string[] = [];
    let accStart = baseSpans[0].start;
    let accEnd = baseSpans[0].end;
    let accLen = 0;
    for (const s of baseSpans) {
      const addedLen = (accTexts.length > 0 ? 1 : 0) + s.text.length;
      if (accTexts.length > 0 && accLen + addedLen > maxChars) {
        chunks.push({ index: chunks.length, start: accStart, end: accEnd, text: accTexts.join(" ") });
        accTexts = [s.text];
        accStart = s.start;
        accEnd = s.end;
        accLen = s.text.length;
      } else {
        if (accTexts.length === 0) accStart = s.start;
        accTexts.push(s.text);
        accEnd = s.end;
        accLen += addedLen;
      }
    }
    if (accTexts.length > 0) {
      chunks.push({ index: chunks.length, start: accStart, end: accEnd, text: accTexts.join(" ") });
    }
  }

  return chunks.map((c) => {
    const contentHash = hashTextContent(
      `sel:${params.bookId}:${c.index}:${params.language}:${params.voiceId}:${params.style}:${c.text}`,
    );
    return {
      id: `sel_${c.index}_${contentHash.slice(0, 8)}`,
      bookId: params.bookId,
      chapterId: params.chapterId || "selection",
      chapterTitle: params.chapterTitle || "Selected Text",
      blockId: params.blockId || "selection",
      blockIndex: params.blockIndex ?? 0,
      sentenceIndex: c.index,
      sentenceCount: chunks.length,
      charStart: c.start,
      charEnd: c.end,
      page: params.page ?? 1,
      text: c.text,
      language: params.language,
      voiceId: params.voiceId,
      style: params.style,
      contentHash,
      hasDialogue: detectDialogueParts(c.text).some((p) => p.speaker === "Speaker"),
    };
  });
}

/**
 * Resolves exact chapterIndex and blockIndex from saved chapterId / blockId
 * so remote listening progress restores accurately even when indices weren't stored.
 */
export function resolveChapterAndBlockIndex(
  book: ReflowBook,
  chapters: Chapter[],
  chapterId?: string,
  blockId?: string,
  fallbackChapterIndex = 0,
): { chapterIndex: number; blockIndex: number } {
  let blockIndex = -1;
  if (blockId) {
    blockIndex = book.blocks.findIndex((b) => b.id === blockId);
  }

  let chapterIndex = -1;
  if (blockIndex >= 0) {
    for (let i = 0; i < chapters.length; i++) {
      const next = chapters[i + 1];
      if (!next || blockIndex < next.blockIndex) {
        chapterIndex = i;
        break;
      }
    }
  }

  if (chapterIndex < 0 && chapterId) {
    chapterIndex = chapters.findIndex((c) => c.id === chapterId);
  }

  if (chapterIndex < 0) {
    chapterIndex = Math.max(0, Math.min(fallbackChapterIndex, Math.max(0, chapters.length - 1)));
  }

  if (blockIndex < 0) {
    blockIndex = chapters[chapterIndex]?.blockIndex ?? 0;
  }

  return { chapterIndex, blockIndex };
}

