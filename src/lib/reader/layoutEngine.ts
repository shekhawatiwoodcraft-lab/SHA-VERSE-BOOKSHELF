import type { Block, Direction } from "./types";
import { hasMathEquationSyntax, normalizeReaderText, repairSmallCaps } from "./sanitize";

const RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const CJK_RE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;
const COMBINING_NO_SPACE_RE = /^[\p{M}\u0900-\u0903\u093A-\u094F\u0951-\u0957\u0962\u0963\u064B-\u065F\u0670]/u;
const PUNCT_NO_LEAD_SPACE_RE = /^[,.;:!?\)\]\}%'"”’।॥۔؟]/;
const SENTENCE_END_RE = /[.!?"'”’)\]]\s*$|[۔।؟]\s*$/;
export const BULLET_RE =
  /^\s*([•▪◦●○■□◆◇▸▹‣⁃·–—*]|\(?\d{1,3}[.)]|[a-zA-Z]\)|[ivxlcdm]+\)|[०-९]+[.)]|[٠-٩]+[.)])\s+/u;

export interface RawTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  size: number;
  bold: boolean;
  italic: boolean;
}

export interface Line {
  text: string;
  x: number;
  right: number;
  y: number;
  size: number;
  bold: boolean;
  italic: boolean;
  itemXs: number[];
}

export interface GroupContext {
  bodySize: number;
  bodySamples: number[];
}

export interface PageBlocksResult {
  blocks: Block[];
  lastLineFull: boolean;
  firstLineIndent: boolean;
}

const isCjk = (s: string) => CJK_RE.test(s);

const countMatches = (s: string, re: RegExp) => {
  let count = 0;
  for (const ch of s) {
    if (re.test(ch)) count++;
  }
  return count;
};

export const isPredominantlyRtl = (s: string) => {
  const rtlCount = countMatches(s, RTL_RE);
  if (rtlCount === 0) return false;
  const ltrCount = countMatches(s, /[A-Za-zÀ-ÿ\u0900-\u097F]/);
  return rtlCount >= ltrCount;
};

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Remove duplicate overlapping / faux-bold / shadow text items drawn at near-identical
 * PDF coordinates (preventing "RReeaaddiinngg" or "Reading Reading").
 */
export function dedupeRawItems(items: RawTextItem[]): RawTextItem[] {
  if (items.length <= 1) return items;
  const out: RawTextItem[] = [];
  for (const item of items) {
    const trimmed = item.str.trim();
    if (!trimmed) {
      out.push(item);
      continue;
    }
    const tolY = Math.max(item.size * 0.22, 1.8);
    const tolX = Math.max(item.size * 0.25, 2.2);
    let duplicateOf: RawTextItem | null = null;

    for (let i = out.length - 1; i >= 0; i--) {
      const existing = out[i];
      if (Math.abs(existing.y - item.y) > tolY) {
        if (out.length - i > 60) break;
        continue;
      }
      if (
        existing.str.trim() === trimmed &&
        Math.abs(existing.x - item.x) <= tolX &&
        Math.abs(existing.size - item.size) <= Math.max(2, existing.size * 0.25)
      ) {
        duplicateOf = existing;
        break;
      }
    }

    if (duplicateOf) {
      if (Math.abs(duplicateOf.x - item.x) > 0.05) {
        duplicateOf.bold = true;
      }
      continue;
    }
    out.push({ ...item });
  }
  return out;
}

/**
 * Order items inside an RTL-dominant line so RTL words read logically right-to-left
 * while contiguous embedded LTR runs (English words/multi-token phrases) stay left-to-right.
 */
function orderRtlLineItems(bucket: RawTextItem[]): RawTextItem[] {
  const rtlSorted = [...bucket].sort((a, b) => b.x - a.x);
  const out: RawTextItem[] = [];
  let ltrRun: RawTextItem[] = [];

  const isPureLtrToken = (s: string) => {
    const t = s.trim();
    return t.length > 0 && /[A-Za-zÀ-ÿ]/.test(t) && !RTL_RE.test(t);
  };

  const flushLtr = () => {
    if (!ltrRun.length) return;
    ltrRun.sort((a, b) => a.x - b.x);
    out.push(...ltrRun);
    ltrRun = [];
  };

  for (const item of rtlSorted) {
    if (isPureLtrToken(item.str)) {
      ltrRun.push(item);
    } else {
      flushLtr();
      out.push(item);
    }
  }
  flushLtr();
  return out;
}

/** Group raw pdf.js text items into accurate visual lines. */
export function buildLines(items: Array<{ str?: unknown; transform?: number[]; width?: number; fontName?: string }>): Line[] {
  const mapped: RawTextItem[] = items
    .filter((it) => typeof it.str === "string" && it.str.length > 0)
    .map((it) => {
      const t = it.transform || [10, 0, 0, 10, 0, 0];
      const size = Math.hypot(t[0], t[1]) || Math.hypot(t[2], t[3]) || 10;
      const font = String(it.fontName || "");
      return {
        str: it.str as string,
        x: Number(t[4]) || 0,
        y: Number(t[5]) || 0,
        width: Math.max(0, Number(it.width) || 0),
        size,
        bold: /bold|black|heavy|semibold/i.test(font),
        italic: /italic|oblique/i.test(font),
      };
    });

  if (!mapped.length) return [];

  const raw = dedupeRawItems(mapped);
  const buckets: RawTextItem[][] = [];
  const sorted = [...raw].sort((a, b) => b.y - a.y);
  let current: RawTextItem[] = [];
  let currentY = sorted[0].y;

  for (const item of sorted) {
    const tolerance = Math.max(item.size * 0.48, 2);
    if (Math.abs(item.y - currentY) <= tolerance) {
      current.push(item);
    } else {
      if (current.length) buckets.push(current);
      current = [item];
      currentY = item.y;
    }
  }
  if (current.length) buckets.push(current);

  return buckets
    .map((bucket) => {
      const combinedRaw = bucket.map((b) => b.str).join("");
      const rtlLine = isPredominantlyRtl(combinedRaw);
      const ltrSorted = [...bucket].sort((a, b) => a.x - b.x);
      const ordered = rtlLine ? orderRtlLineItems(bucket) : ltrSorted;

      let text = "";
      let prev: RawTextItem | null = null;

      for (const item of ordered) {
        const s = item.str;
        if (s === " " && (!text || /\s$/.test(text))) {
          prev = item;
          continue;
        }
        if (
          !rtlLine &&
          prev &&
          s.trim().length > 1 &&
          prev.str.trim() === s.trim() &&
          item.x < prev.x + prev.width * 0.4
        ) {
          continue;
        }

        if (prev && text) {
          const isSmallCapGlue =
            !rtlLine &&
            /^[A-Z]$/.test(prev.str.trim()) &&
            /^[A-Z]{2,}/.test(s.trim()) &&
            prev.size > item.size * 1.12;

          const gapRight = item.x - (prev.x + prev.width);
          const gapLeft = prev.x - (item.x + item.width);
          const horizontalGap = rtlLine
            ? (item.x > prev.x + prev.width * 0.5 ? gapRight : gapLeft)
            : gapRight;

          const prevEndsWithHalant = /[\u094D\u09CD\u0A4D\u0ACD\u0B4D\u0C4D\u0D4D\u200D]$/.test(prev.str);
          const noSpaceBefore =
            COMBINING_NO_SPACE_RE.test(s) ||
            PUNCT_NO_LEAD_SPACE_RE.test(s) ||
            prevEndsWithHalant ||
            isCjk(s) ||
            isSmallCapGlue;

          if (
            !noSpaceBefore &&
            horizontalGap > Math.max(prev.size, item.size) * 0.18 &&
            !/\s$/.test(text) &&
            !/^\s/.test(s)
          ) {
            text += " ";
          } else if (isSmallCapGlue && /\s$/.test(text)) {
            text = text.replace(/\s+$/, "");
          }
        }

        text += s;
        prev = item;
      }

      const cleanText = repairSmallCaps(normalizeReaderText(text));
      const sizes = ltrSorted.map((i) => i.size);
      const first = ltrSorted[0];
      const last = ltrSorted[ltrSorted.length - 1];
      return {
        text: cleanText,
        x: first.x,
        right: Math.max(...ltrSorted.map((i) => i.x + i.width), last.x),
        y: first.y,
        size: median(sizes),
        bold: ltrSorted.filter((i) => i.bold).length > ltrSorted.length / 2,
        italic: ltrSorted.filter((i) => i.italic).length > ltrSorted.length / 2,
        itemXs: ltrSorted.map((i) => i.x),
      };
    })
    .filter((l) => l.text.length > 0);
}

/**
 * Detect a two-column layout (even when preceded/followed by full-width titles or footnotes)
 * and return lines in true reading order (LTR: left -> right, RTL: right -> left).
 */
export function orderColumns(lines: Line[], pageWidth: number): Line[] {
  if (lines.length < 6 || pageWidth <= 0) return lines;
  const mid = pageWidth / 2;

  const spansAcrossMid = (l: Line) =>
    l.x < mid - pageWidth * 0.08 && l.right > mid + pageWidth * 0.08;

  const out: Line[] = [];
  let band: Line[] = [];

  const flushBand = () => {
    if (!band.length) return;
    if (band.length >= 6) {
      const left = band.filter((l) => l.right <= mid + pageWidth * 0.04);
      const right = band.filter((l) => l.x >= mid - pageWidth * 0.04);
      const covered = left.length + right.length;
      if (
        covered >= band.length * 0.9 &&
        left.length >= band.length * 0.25 &&
        right.length >= band.length * 0.25
      ) {
        const bandText = band.map((l) => l.text).join(" ");
        if (isPredominantlyRtl(bandText)) {
          out.push(...right, ...left);
        } else {
          out.push(...left, ...right);
        }
        band = [];
        return;
      }
    }
    out.push(...band);
    band = [];
  };

  for (const line of lines) {
    if (spansAcrossMid(line)) {
      flushBand();
      out.push(line);
    } else {
      band.push(line);
    }
  }
  flushBand();
  return out;
}

/** Normalize edge text for running header/footer repetition detection. */
export function normalizeEdgePattern(text: string): string {
  return text
    .replace(/\d+/g, "#")
    .replace(/\b[ivxlcdm]+\b/gi, (m) => (m.length <= 5 ? "#" : m))
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * Strip ONLY genuine running headers, footers, and page folios near top/bottom edges.
 * Never deletes genuine opening headings, chapter titles, or first lines.
 */
export function filterRunningEdges(
  lines: Line[],
  pageHeight: number,
  bodySize: number,
  edgeTextCounts: Map<string, number>,
  outlineTitle?: string,
): Line[] {
  const normOutline = outlineTitle ? outlineTitle.toLowerCase().trim() : "";

  return lines.filter((line) => {
    const nearEdge = line.y > pageHeight * 0.87 || line.y < pageHeight * 0.11;
    if (!nearEdge) return true;

    const trimmed = line.text.trim();
    const isLargeHeading = bodySize > 0 && line.size >= bodySize * 1.28;
    const matchesOutline = normOutline.length > 2 && trimmed.toLowerCase().includes(normOutline);
    if (isLargeHeading || matchesOutline) return true;

    const looksLikeFolio =
      (/^[ivxlcdm\d\s\-—–.()\[\]]+$/i.test(trimmed) && trimmed.length <= 14) ||
      /^page\s+\d+(\s+of\s+\d+)?$/i.test(trimmed);

    const key = normalizeEdgePattern(trimmed);
    const seen = edgeTextCounts.get(key) ?? 0;
    if (trimmed.length <= 90) edgeTextCounts.set(key, seen + 1);

    const looksLikeNumberedRunningHeader =
      trimmed.length <= 65 &&
      (/(^\d{1,4}\s+[A-Z])|([a-zA-Z]\s+\d{1,4}$)/.test(trimmed) ||
        /(^[ivxlcdm]{1,5}\s+[A-Z])|([a-zA-Z]\s+[ivxlcdm]{1,5}$)/i.test(trimmed));

    const repeated = trimmed.length <= 90 && (seen >= 2 || (seen >= 1 && looksLikeNumberedRunningHeader));

    return !(looksLikeFolio || repeated);
  });
}

function detectTable(lines: Line[], startIndex: number): { rows: string[][]; consumed: number } | null {
  const candidate: Line[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const gaps = line.itemXs
      .slice(1)
      .map((x, idx) => x - line.itemXs[idx])
      .filter((g) => g > line.size * 2.5);
    if (gaps.length >= 2 && line.text.length < 200 && !hasMathEquationSyntax(line.text)) {
      candidate.push(line);
    } else {
      break;
    }
  }
  if (candidate.length < 3) return null;

  const columnAnchors = candidate[0].itemXs.filter(
    (x, idx, arr) => idx === 0 || x - arr[idx - 1] > candidate[0].size * 2.5,
  );
  const rows = candidate.map((line) =>
    line.text.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean),
  );
  const width = Math.max(...rows.map((r) => r.length));
  if (width < 2 || columnAnchors.length < 2) return null;
  return {
    rows: rows.map((r) => [...r, ...Array(width - r.length).fill("")]),
    consumed: candidate.length,
  };
}

function joinLines(parts: Line[]): string {
  let text = "";
  for (const part of parts) {
    const chunk = part.text;
    if (!text) {
      text = chunk;
      continue;
    }
    if (/[-\u2010\u00AD]$/.test(text) && /^[a-zà-öø-ÿ]/.test(chunk)) {
      text = text.replace(/[-\u2010\u00AD]$/, "") + chunk;
    } else if (isCjk(text.slice(-1)) && isCjk(chunk.slice(0, 1))) {
      text += chunk;
    } else {
      text += " " + chunk;
    }
  }
  return text.replace(/\s+/g, " ").trim();
}

/** Merge visual lines into semantic blocks (headings, paragraphs, tables, lists, equations). */
export function linesToBlocks(
  lines: Line[],
  page: number,
  ctx: GroupContext,
  nextId: () => string,
): PageBlocksResult {
  const blocks: Block[] = [];
  if (!lines.length) return { blocks, lastLineFull: false, firstLineIndent: false };

  ctx.bodySamples.push(...lines.map((l) => l.size));
  if (ctx.bodySamples.length > 4000) ctx.bodySamples.splice(0, ctx.bodySamples.length - 4000);
  ctx.bodySize = median(ctx.bodySamples) || lines[0].size;

  const lineGaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0) lineGaps.push(gap);
  }
  const baseGap = median(lineGaps) || ctx.bodySize * 1.2;
  const columnRight = Math.max(...lines.map((l) => l.right));
  const columnLeft = Math.min(...lines.map((l) => l.x));
  const columnWidth = Math.max(columnRight - columnLeft, 1);

  const reachesEdge = (line: Line) => line.right >= columnRight - columnWidth * 0.12;

  const flush = (group: Line[]) => {
    if (!group.length) return;
    const text = joinLines(group);
    if (!text) return;
    const dir: Direction = isPredominantlyRtl(text) ? "rtl" : "ltr";
    const size = median(group.map((l) => l.size));
    const bold = group.filter((l) => l.bold).length > group.length / 2;
    const ratio = ctx.bodySize > 0 ? size / ctx.bodySize : 1;
    const short = text.length <= 140 && group.length <= 3;

    const isMathLine = group.length === 1 && hasMathEquationSyntax(text);
    const isHeading =
      !isMathLine &&
      !BULLET_RE.test(text) &&
      short &&
      (ratio >= 1.18 || (bold && ratio >= 1.02)) &&
      !/[.,;:]$/.test(text);

    if (isHeading) {
      const level: 1 | 2 | 3 = ratio >= 1.7 ? 1 : ratio >= 1.32 ? 2 : 3;
      blocks.push({ id: nextId(), page, type: "heading", level, text, dir });
      return;
    }

    const small = ratio <= 0.82;
    const quote =
      !small &&
      !BULLET_RE.test(text) &&
      group.every((l) => l.x > columnLeft + columnWidth * 0.08) &&
      group.every((l) => l.right < columnRight - columnWidth * 0.05) &&
      group.length >= 2;

    blocks.push({
      id: nextId(),
      page,
      type: "paragraph",
      text,
      dir,
      indent: group[0].x > columnLeft + ctx.bodySize * 0.8,
      quote: quote || undefined,
      small: small || undefined,
    });
  };

  let firstTextLine: Line | null = null;
  let lastTextLine: Line | null = null;

  let group: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    const table = detectTable(lines, i);
    if (table) {
      flush(group);
      group = [];
      blocks.push({ id: nextId(), page, type: "table", rows: table.rows });
      i += table.consumed - 1;
      continue;
    }

    const line = lines[i];
    if (!firstTextLine) firstTextLine = line;
    lastTextLine = line;

    const prev = lines[i - 1];
    if (!prev) {
      group = [line];
      continue;
    }

    const gap = prev.y - line.y;
    const columnJump = gap < 0 || gap > baseGap * 2.2;
    const hardGap = gap > baseGap * 1.55;
    const bulletStart = BULLET_RE.test(line.text);
    const mathBreak =
      (hasMathEquationSyntax(line.text) && line.x > columnLeft + ctx.bodySize * 1.4) ||
      (hasMathEquationSyntax(prev.text) && prev.x > columnLeft + ctx.bodySize * 1.4);

    const sizeShift =
      Math.abs(line.size - prev.size) > Math.max(prev.size * 0.28, 1.6) &&
      Math.abs(line.size - prev.size) > 1;

    const prevContinues = reachesEdge(prev);
    const indentStart = line.x > prev.x + Math.max(line.size * 0.7, 4);
    const sentenceBreak = SENTENCE_END_RE.test(prev.text);

    const softBreak =
      !prevContinues && (indentStart || (sentenceBreak && hardGap) || (sentenceBreak && indentStart));

    if (columnJump || bulletStart || mathBreak || sizeShift || (hardGap && !prevContinues) || softBreak) {
      flush(group);
      group = [line];
    } else {
      group.push(line);
    }
  }
  flush(group);

  return {
    blocks,
    lastLineFull: lastTextLine ? reachesEdge(lastTextLine) : false,
    firstLineIndent: firstTextLine ? firstTextLine.x > columnLeft + ctx.bodySize * 0.8 : false,
  };
}
