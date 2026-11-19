/**
 * PDF → reflowable book extractor.
 *
 * Runs incrementally (page by page) so the reader can start showing content
 * immediately while the rest of the book is still being processed. Heavy
 * parsing happens inside the pdf.js worker thread; grouping heuristics run
 * progressively with UI yields so the interface remains responsive.
 */
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type {
  Block,
  Chapter,
  Direction,
  ParagraphBlock,
  ReflowBook,
  ReflowBookMeta,
} from "./types";

import { REFLOW_MODEL_VERSION } from "./types";
import { assessPageText, isBoilerplate, isGarbageLine } from "./quality";
import {
  BULLET_RE,
  buildLines,
  dedupeRawItems,
  filterRunningEdges,
  isPredominantlyRtl,
  linesToBlocks,
  normalizeEdgePattern,
  orderColumns,
  type GroupContext,
  type Line,
  type RawTextItem,
} from "./layoutEngine";

export {
  buildLines,
  dedupeRawItems,
  filterRunningEdges,
  linesToBlocks,
  normalizeEdgePattern,
  orderColumns,
  type Line,
  type RawTextItem,
};

if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export interface ExtractProgress {
  page: number;
  totalPages: number;
  /** Blocks produced for this page (already appended to `book.blocks`). */
  book: ReflowBook;
  done: boolean;
  ocrUsed: boolean;
}

const yieldToUi = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });

function isFlatUniformImage(data: Uint8ClampedArray): boolean {
  if (data.length < 16) return true;
  const sampleStep = Math.max(4, Math.floor(data.length / 400) * 4);
  const r0 = data[0];
  const g0 = data[1];
  const b0 = data[2];
  let diff = 0;
  let count = 0;
  for (let i = 0; i < data.length - 3; i += sampleStep) {
    diff += Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0);
    count++;
  }
  return count > 0 && diff / count < 4;
}

async function extractPageImages(
  page: any,
  pageNumber: number,
  nextId: () => string
): Promise<Block[]> {
  const blocks: Block[] = [];
  if (typeof document === "undefined") return blocks;
  try {
    const ops = await page.getOperatorList();
    const names: string[] = [];
    const imageOps = [
      pdfjsLib.OPS.paintImageXObject,
      (pdfjsLib.OPS as Record<string, number>).paintJpegXObject,
    ].filter((op) => typeof op === "number");
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (imageOps.includes(ops.fnArray[i])) {
        const name = ops.argsArray[i]?.[0];
        if (typeof name === "string" && !names.includes(name)) names.push(name);
      }
    }

    for (const name of names.slice(0, 6)) {
      const img: any = await new Promise((resolve) => {
        try {
          if (page.objs.has(name)) resolve(page.objs.get(name));
          else page.objs.get(name, resolve);
        } catch {
          resolve(null);
        }
      });
      if (!img || !img.width || !img.height) continue;
      if (img.width < 120 || img.height < 120) continue;

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) continue;

      if (img.bitmap) {
        ctx2d.drawImage(img.bitmap, 0, 0);
      } else if (img.data) {
        const imageData = ctx2d.createImageData(img.width, img.height);
        const src = img.data as Uint8ClampedArray;
        const dst = imageData.data;
        if (src.length === img.width * img.height * 4) {
          dst.set(src);
        } else if (src.length === img.width * img.height * 3) {
          for (let p = 0, q = 0; p < src.length; p += 3, q += 4) {
            dst[q] = src[p];
            dst[q + 1] = src[p + 1];
            dst[q + 2] = src[p + 2];
            dst[q + 3] = 255;
          }
        } else {
          continue;
        }
        if (isFlatUniformImage(dst)) continue;
        ctx2d.putImageData(imageData, 0, 0);
      } else {
        continue;
      }

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/webp", 0.82)
      );
      if (!blob) continue;
      blocks.push({
        id: nextId(),
        page: pageNumber,
        type: "image",
        blob,
        width: img.width,
        height: img.height,
        alt: `Illustration from page ${pageNumber}`,
      });
    }
  } catch {
    // Image extraction is best-effort — never block text extraction.
  }
  return blocks;
}

/** Render a page to a Blob (used as fallback for scanned / corrupt-font pages). */
async function renderPageToBlob(
  page: any,
  targetWidth = 1400
): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (typeof document === "undefined") return null;
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.4, Math.max(1, targetWidth / base.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/webp", 0.85)
  );
  return blob ? { blob, width: canvas.width, height: canvas.height } : null;
}

export interface ExtractOptions {
  bookId: string;
  title?: string;
  author?: string;
  /** Run OCR on pages that contain no extractable text. Loaded lazily. */
  ocr?: boolean;
  ocrLanguage?: string;
  signal?: AbortSignal;
}

/**
 * Incrementally converts a PDF into the internal reflowable model.
 * Yields after every page so callers can render progressively.
 */
export async function* extractReflowBook(
  url: string,
  options: ExtractOptions
): AsyncGenerator<ExtractProgress> {
  const loadingTask = pdfjsLib.getDocument({
    url,
    cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
    disableStream: false,
    disableAutoFetch: true,
    rangeChunkSize: 262144,
    withCredentials: false,
  });
  const pdf = await loadingTask.promise;

  let counter = 0;
  const nextId = () => `b${counter++}`;
  const ctx: GroupContext = { bodySize: 12, bodySamples: [] };

  let info: any = {};
  try {
    info = (await pdf.getMetadata())?.info ?? {};
  } catch {
    /* metadata is optional */
  }

  const meta: ReflowBookMeta = {
    title: options.title || info.Title || undefined,
    author: options.author || info.Author || undefined,
    language: info.Language || undefined,
    totalPages: pdf.numPages,
    scanned: false,
    ocrPages: 0,
    rasterizedPages: 0,
    extractionWarnings: [],
    dir: "ltr",
  };

  const book: ReflowBook = {
    version: REFLOW_MODEL_VERSION,
    bookId: options.bookId,
    meta,
    blocks: [],
    chapters: [],
  };

  // Seed chapters from the PDF outline when available (for TOC navigation only — never fabricate visible blocks).
  const outlinePages = new Map<number, string>();
  try {
    const outline = await pdf.getOutline();
    if (outline?.length) {
      const walk = async (items: any[], level: number) => {
        for (const item of items) {
          try {
            const dest =
              typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
            if (dest?.[0]) {
              const pageIndex = await pdf.getPageIndex(dest[0]);
              if (!outlinePages.has(pageIndex + 1)) {
                outlinePages.set(pageIndex + 1, item.title);
              }
              book.chapters.push({
                id: `c${book.chapters.length}`,
                title: item.title,
                blockIndex: -1,
                page: pageIndex + 1,
                level,
              });
            }
          } catch {
            /* skip unresolvable outline entries */
          }
          if (item.items?.length && level < 2) await walk(item.items, level + 1);
        }
      };
      await walk(outline, 0);
    }
  } catch {
    /* outline is optional */
  }

  let ocrUsed = false;
  let ocrWorker: { recognize: (img: Blob) => Promise<string[]>; terminate?: () => Promise<void> } | null = null;
  const edgeTextCounts = new Map<string, number>();
  let pendingContinuation: ParagraphBlock | null = null;

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (options.signal?.aborted) return;

      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      let lines = buildLines(content.items as any[]);
      lines = orderColumns(lines, viewport.width);
      lines = filterRunningEdges(
        lines,
        viewport.height,
        ctx.bodySize || 12,
        edgeTextCounts,
        outlinePages.get(pageNumber)
      );

      const quality = assessPageText(lines.map((l) => l.text));
      const startIndex = book.blocks.length;

      if (quality.unusable) {
        pendingContinuation = null;
        meta.scanned = true;

        const rendered = await renderPageToBlob(page);
        let recognised = false;

        // OCR is only attempted when no extractable text exists (genuinely scanned/empty page).
        if (options.ocr && rendered && quality.reason === "empty") {
          try {
            if (!ocrWorker) {
              const { createOcrWorker } = await import("./ocr");
              ocrWorker = await createOcrWorker(options.ocrLanguage || "eng");
            }
            const paragraphs = (await ocrWorker.recognize(rendered.blob))
              .map((text) => normalizeReaderText(text))
              .filter((text) => text.length >= 2 && !isGarbageLine(text) && !isBoilerplate(text));

            if (paragraphs.length && !assessPageText(paragraphs).unusable) {
              ocrUsed = true;
              recognised = true;
              meta.ocrPages = (meta.ocrPages ?? 0) + 1;
              for (const clean of paragraphs) {
                book.blocks.push({
                  id: nextId(),
                  page: pageNumber,
                  type: "paragraph",
                  text: clean,
                  dir: isPredominantlyRtl(clean) ? "rtl" : "ltr",
                });
              }
            }
          } catch {
            /* OCR is best-effort — never output unreliable guesses */
          }
        }

        if (!recognised && rendered) {
          meta.rasterizedPages = (meta.rasterizedPages ?? 0) + 1;
          book.blocks.push({
            id: nextId(),
            page: pageNumber,
            type: "image",
            blob: rendered.blob,
            width: rendered.width,
            height: rendered.height,
            alt: `Page ${pageNumber}`,
            fullPage: true,
          });
        }
      } else {
        lines = lines.filter((line) => !isBoilerplate(line.text) && !isGarbageLine(line.text));

        const hasOutlineHeading = outlinePages.has(pageNumber);
        const carry = pendingContinuation;
        pendingContinuation = null;
        const { blocks: textBlocks, lastLineFull, firstLineIndent } = linesToBlocks(
          lines,
          pageNumber,
          ctx,
          nextId
        );
        const imageBlocks = await extractPageImages(page, pageNumber, nextId);

        const firstBlock = textBlocks[0];
        if (
          carry &&
          !hasOutlineHeading &&
          !firstLineIndent &&
          firstBlock &&
          firstBlock.type === "paragraph" &&
          !firstBlock.quote &&
          !firstBlock.small &&
          !carry.quote &&
          !carry.small &&
          !BULLET_RE.test(firstBlock.text)
        ) {
          if (/[-\u2010\u00AD]$/.test(carry.text) && /^[a-zà-öø-ÿ]/.test(firstBlock.text)) {
            carry.text = carry.text.replace(/[-\u2010\u00AD]$/, "") + firstBlock.text;
          } else {
            carry.text = `${carry.text} ${firstBlock.text}`.replace(/\s+/g, " ").trim();
          }
          textBlocks.shift();
        }

        book.blocks.push(...textBlocks, ...imageBlocks);

        if (lastLineFull && !imageBlocks.length) {
          const last = book.blocks[book.blocks.length - 1];
          if (last && last.type === "paragraph") pendingContinuation = last;
        }
      }

      book.blocks.push({ id: nextId(), page: pageNumber, type: "pagebreak" });

      for (const chapter of book.chapters) {
        if (chapter.blockIndex === -1 && chapter.page === pageNumber) {
          chapter.blockIndex = startIndex;
        }
      }

      if (book.blocks.some((b) => b.type !== "pagebreak" && (b as any).dir === "rtl")) {
        meta.dir = "rtl";
      }

      page.cleanup();
      yield { page: pageNumber, totalPages: pdf.numPages, book, done: false, ocrUsed };
      await yieldToUi();
    }
  } finally {
    if (ocrWorker?.terminate) {
      await ocrWorker.terminate().catch(() => {});
    }
  }

  if (!book.chapters.length) {
    book.blocks.forEach((block, index) => {
      if (block.type === "heading" && block.level <= 2) {
        book.chapters.push({
          id: `c${book.chapters.length}`,
          title: block.text,
          blockIndex: index,
          page: block.page,
          level: block.level - 1,
        });
      }
    });
  }
  book.chapters = book.chapters.filter((c) => c.blockIndex >= 0);

  const warnings: string[] = [];
  if ((meta.ocrPages ?? 0) > 0) {
    warnings.push(`OCR extracted text on ${meta.ocrPages} scanned page${meta.ocrPages === 1 ? "" : "s"}.`);
  }
  if ((meta.rasterizedPages ?? 0) > 0) {
    warnings.push(
      `Original page rendering used on ${meta.rasterizedPages} page${meta.rasterizedPages === 1 ? "" : "s"} where text glyphs could not be safely decoded.`
    );
  }
  meta.extractionWarnings = warnings;

  try {
    await pdf.destroy();
  } catch {
    /* ignore */
  }

  yield { page: pdf.numPages, totalPages: pdf.numPages, book, done: true, ocrUsed };
}
