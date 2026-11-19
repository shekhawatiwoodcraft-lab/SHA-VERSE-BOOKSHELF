import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import ePub from "epubjs";
import type { BookCategory } from "@/lib/constants/bookshelf";
import { checkBookDuplicate, generateFileHash, type DuplicateCheckResult } from "./fileHash";
import {
  buildAutoDescription,
  cleanTextWhitespace,
  detectCategory,
  detectLanguage,
  extractTitleAuthorFromPageLines,
  isJunkMetadataValue,
  parseTitleAndAuthorFromFilename,
  stripHtmlTags,
  type PageLineSample,
  type PageTextSample,
} from "./bookMetadataHeuristics";

if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export type CoverSource = "pdf-page" | "epub-cover" | "generated" | "custom";

export interface BookAnalysisResult {
  title: string;
  author: string;
  category: BookCategory;
  language: string;
  description: string;
  pages: number;
  coverFile: File | null;
  coverPreviewUrl: string | null;
  coverSource: CoverSource;
  fileHash: string;
  duplicate: DuplicateCheckResult;
  warnings: string[];
}

function isCanvasMostlyBlank(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    const stepX = Math.max(4, Math.floor(width / 40));
    const stepY = Math.max(4, Math.floor(height / 40));
    const data = ctx.getImageData(0, 0, width, height).data;
    let nonWhiteSamples = 0;
    let totalSamples = 0;
    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        totalSamples++;
        if (a > 10 && (r < 245 || g < 245 || b < 245)) {
          nonWhiteSamples++;
        }
      }
    }
    return totalSamples > 0 && nonWhiteSamples / totalSamples < 0.015;
  } catch {
    return false;
  }
}

async function canvasToJpegFile(canvas: HTMLCanvasElement, baseName: string): Promise<File | null> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.88);
  });
  if (!blob) return null;
  const safeName = baseName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "book";
  return new File([blob], `${safeName}_cover.jpg`, { type: "image/jpeg" });
}

/**
 * Generates a clean typographic cover JPEG when an EPUB/TXT/MOBI lacks an embedded cover image.
 */
export async function generateTypographicCoverFile(params: {
  title: string;
  author: string;
  category: string;
}): Promise<File | null> {
  if (typeof document === "undefined") return null;

  const width = 480;
  const height = 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Deterministic palette per category
  const palettes: Record<string, [string, string, string]> = {
    Technology: ["#0f172a", "#1e3a8a", "#38bdf8"],
    Science: ["#0f172a", "#134e4a", "#2dd4bf"],
    Business: ["#18181b", "#3f3f46", "#f59e0b"],
    "Self-Help": ["#1e1b4b", "#4338ca", "#a78bfa"],
    Motivational: ["#450a0a", "#991b1b", "#fbbf24"],
    Education: ["#0c4a6e", "#0369a1", "#bae6fd"],
    History: ["#292524", "#57534e", "#fcd34d"],
    Religion: ["#064e3b", "#047857", "#fde68a"],
    Poetry: ["#3b0764", "#6b21a8", "#f0abfc"],
    Health: ["#052e16", "#15803d", "#86efac"],
    Cooking: ["#431407", "#9a3412", "#fdba74"],
    Biography: ["#1e293b", "#334155", "#cbd5e1"],
    Fiction: ["#172554", "#1d4ed8", "#93c5fd"],
  };
  const [c1, c2, accent] = palettes[params.category] || ["#1e293b", "#0f172a", "#60a5fa"];

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Spine & border framing
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(0, 0, 26, height);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2;
  ctx.strokeRect(42, 36, width - 66, height - 72);
  ctx.globalAlpha = 1;

  // Category badge text
  ctx.fillStyle = accent;
  ctx.font = "600 16px system-ui, -apple-system, sans-serif";
  ctx.fillText(params.category.toUpperCase(), 62, 86);

  // Word-wrap title cleanly
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 34px Georgia, serif";
  const words = cleanTextWhitespace(params.title || "Untitled Book").split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const testLine = current ? `${current} ${w}` : w;
    if (ctx.measureText(testLine).width > width - 124 && current) {
      lines.push(current);
      current = w;
      if (lines.length >= 5) break;
    } else {
      current = testLine;
    }
  }
  if (current && lines.length < 6) lines.push(current);

  let y = 175;
  for (const line of lines) {
    ctx.fillText(line, 62, y);
    y += 46;
  }

  // Divider bar
  ctx.fillStyle = accent;
  ctx.fillRect(62, Math.min(y + 18, height - 160), 90, 4);

  // Author footer
  if (params.author) {
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = "500 22px system-ui, -apple-system, sans-serif";
    ctx.fillText(params.author.slice(0, 34), 62, height - 80);
  }

  const file = await canvasToJpegFile(canvas, params.title);
  canvas.width = 0;
  canvas.height = 0;
  return file;
}

async function renderPdfCover(pdfDoc: pdfjsLib.PDFDocumentProxy, titleHint: string): Promise<File | null> {
  if (typeof document === "undefined" || pdfDoc.numPages < 1) return null;

  const candidatePages = pdfDoc.numPages >= 2 ? [1, 2] : [1];
  for (const pageNum of candidatePages) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const targetWidth = 560;
      const scale = Math.min(2, Math.max(0.5, targetWidth / Math.max(1, baseViewport.width)));
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport }).promise;

      const isBlank = isCanvasMostlyBlank(ctx, canvas.width, canvas.height);
      if (isBlank && pageNum === 1 && pdfDoc.numPages >= 2) {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
        continue;
      }

      const file = await canvasToJpegFile(canvas, titleHint);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      return file;
    } catch {
      // Try next candidate page
    }
  }
  return null;
}

interface PdfTextItemSample {
  str?: string;
  transform?: number[];
  height?: number;
}

function buildPdfLinesFromTextContent(items: PdfTextItemSample[]): PageLineSample[] {
  const raw: Array<{ text: string; x: number; y: number; fontSize: number }> = [];
  for (const item of items) {
    if (!item || typeof item.str !== "string") continue;
    const str = item.str;
    if (!str.trim()) continue;
    const tr = Array.isArray(item.transform) ? item.transform : [12, 0, 0, 12, 0, 0];
    const fontSize = Math.max(6, Math.abs(Number(item.height) || Math.hypot(tr[2] || 0, tr[3] || 0) || 12));
    raw.push({
      text: str,
      x: Number(tr[4] || 0),
      y: Number(tr[5] || 0),
      fontSize,
    });
  }

  // Group into lines by approximate Y coordinate (descending top-to-bottom in PDF space)
  raw.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; items: typeof raw }> = [];
  for (const r of raw) {
    const tol = Math.max(4, r.fontSize * 0.45);
    const existing = lines.find((l) => Math.abs(l.y - r.y) <= tol);
    if (existing) {
      existing.items.push(r);
    } else {
      lines.push({ y: r.y, items: [r] });
    }
  }

  return lines.map((line) => {
    line.items.sort((a, b) => a.x - b.x);
    const text = cleanTextWhitespace(line.items.map((it) => it.text).join(" "));
    const avgFont =
      line.items.reduce((acc, it) => acc + it.fontSize, 0) / Math.max(1, line.items.length);
    return { text, fontSize: avgFont };
  });
}

async function analyzePdfBook(
  file: File,
  buffer: ArrayBuffer,
  fileHash: string,
): Promise<BookAnalysisResult> {
  const warnings: string[] = [];
  const dataCopy = new Uint8Array(buffer.slice(0));
  const loadingTask = pdfjsLib.getDocument({
    data: dataCopy,
    cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
  });

  const pdfDoc = await loadingTask.promise;
  try {
    const pagesCount = Math.max(1, pdfDoc.numPages || 1);
    const filenameGuess = parseTitleAndAuthorFromFilename(file.name);

    // 1) Read PDF info + XMP metadata
    let metaTitle = "";
    let metaAuthor = "";
    let metaDesc = "";
    let metaLang = "";
    const subjects: string[] = [];

    try {
      const meta = await pdfDoc.getMetadata();
      const info = (meta?.info || {}) as Record<string, unknown>;
      const xmp = meta?.metadata as { get?: (key: string) => string | null } | null;

      const rawTitle =
        (typeof info.Title === "string" ? info.Title : "") ||
        xmp?.get?.("dc:title") ||
        "";
      const rawAuthor =
        (typeof info.Author === "string" ? info.Author : "") ||
        xmp?.get?.("dc:creator") ||
        "";
      const rawSubject =
        (typeof info.Subject === "string" ? info.Subject : "") ||
        xmp?.get?.("dc:description") ||
        "";
      const rawKeywords =
        (typeof info.Keywords === "string" ? info.Keywords : "") ||
        xmp?.get?.("dc:subject") ||
        "";
      const rawLang = xmp?.get?.("dc:language") || (typeof info.Language === "string" ? info.Language : "") || "";

      if (!isJunkMetadataValue(rawTitle)) metaTitle = cleanTextWhitespace(rawTitle);
      if (!isJunkMetadataValue(rawAuthor)) metaAuthor = cleanTextWhitespace(rawAuthor);
      if (rawSubject && !isJunkMetadataValue(rawSubject)) metaDesc = cleanTextWhitespace(rawSubject);
      if (rawKeywords) {
        rawKeywords
          .split(/[,;|]/)
          .map((s) => cleanTextWhitespace(s))
          .filter(Boolean)
          .forEach((s) => subjects.push(s));
      }
      metaLang = cleanTextWhitespace(rawLang);
    } catch {
      // Metadata optional; proceed to page text extraction
    }

    // 2) Extract first 6 pages of structured lines & sample text
    const maxSamplePages = Math.min(6, pagesCount);
    const pageSamples: PageTextSample[] = [];
    const pageTextChunks: string[] = [];

    for (let p = 1; p <= maxSamplePages; p++) {
      try {
        const page = await pdfDoc.getPage(p);
        const tc = await page.getTextContent();
        const lines = buildPdfLinesFromTextContent(tc.items as PdfTextItemSample[]);
        pageSamples.push({ pageNumber: p, lines });
        const joined = lines.map((l) => l.text).join("\n");
        if (joined) pageTextChunks.push(joined);
        page.cleanup();
      } catch {
        // Ignore single page text error
      }
    }

    const sampleText = pageTextChunks.join("\n\n").slice(0, 8000);
    const visualGuess = extractTitleAuthorFromPageLines(pageSamples);

    const title =
      metaTitle ||
      visualGuess.title ||
      filenameGuess.title ||
      file.name.replace(/\.[^/.]+$/, "");

    const author =
      metaAuthor ||
      visualGuess.author ||
      filenameGuess.author ||
      "Unknown Author";

    if (author === "Unknown Author") {
      warnings.push("Author could not be verified automatically — please review if needed.");
    }

    const language = detectLanguage(sampleText, metaLang);
    const category = detectCategory({
      title,
      description: metaDesc,
      subjects,
      sampleText,
    });
    const description = buildAutoDescription({
      embeddedDesc: metaDesc,
      title,
      author,
      sampleText,
      pages: pagesCount,
      language,
      category,
    });

    // 3) Render Page 1 (or Page 2 if blank) as Cover Image
    let coverFile = await renderPdfCover(pdfDoc, title);
    let coverSource: CoverSource = coverFile ? "pdf-page" : "generated";
    if (!coverFile) {
      coverFile = await generateTypographicCoverFile({ title, author, category });
      coverSource = "generated";
    }
    const coverPreviewUrl = coverFile ? URL.createObjectURL(coverFile) : null;

    const duplicate = await checkBookDuplicate({ fileHash, title, author });

    return {
      title,
      author,
      category,
      language,
      description,
      pages: pagesCount,
      coverFile,
      coverPreviewUrl,
      coverSource,
      fileHash,
      duplicate,
      warnings,
    };
  } finally {
    try {
      await pdfDoc.destroy();
    } catch {
      /* ignore cleanup error */
    }
  }
}

async function analyzeEpubBook(
  file: File,
  buffer: ArrayBuffer,
  fileHash: string,
): Promise<BookAnalysisResult> {
  const warnings: string[] = [];
  const filenameGuess = parseTitleAndAuthorFromFilename(file.name);
  const book = ePub(buffer.slice(0));

  try {
    await book.ready;
    const metadata = (await book.loaded.metadata) as unknown as Record<string, unknown>;
    const spine = (await book.loaded.spine) as unknown as {
      spineItems?: Array<{ href?: string; load: (r: unknown) => Promise<Document> }>;
    };

    const rawTitle = typeof metadata?.title === "string" ? cleanTextWhitespace(metadata.title) : "";
    const rawAuthor = typeof metadata?.creator === "string" ? cleanTextWhitespace(metadata.creator) : "";
    const rawDesc = typeof metadata?.description === "string" ? stripHtmlTags(metadata.description) : "";
    const rawLang = typeof metadata?.language === "string" ? cleanTextWhitespace(metadata.language) : "";
    const rawSubjects = Array.isArray(metadata?.subject)
      ? metadata.subject
      : typeof metadata?.subject === "string"
        ? metadata.subject.split(/[,;|]/)
        : [];
    const subjects = rawSubjects.map((s: unknown) => cleanTextWhitespace(String(s || ""))).filter(Boolean);

    const title = !isJunkMetadataValue(rawTitle) ? rawTitle : filenameGuess.title;
    const author = !isJunkMetadataValue(rawAuthor)
      ? rawAuthor
      : filenameGuess.author || "Unknown Author";

    // Sample spine sections to compute accurate page count & text sample
    const spineItems = spine?.spineItems || [];
    const sampleLimit = Math.min(spineItems.length, 24);
    let sampledWords = 0;
    const sampleChunks: string[] = [];

    for (let i = 0; i < sampleLimit; i++) {
      try {
        const doc = await spineItems[i].load(book.load.bind(book));
        const text = cleanTextWhitespace(doc?.body?.textContent || doc?.documentElement?.textContent || "");
        if (text) {
          const words = text.split(/\s+/).filter(Boolean).length;
          sampledWords += words;
          if (sampleChunks.join("\n").length < 7000 && words >= 15) {
            sampleChunks.push(text.slice(0, 2500));
          }
        }
      } catch {
        // Skip unreadable spine section
      }
    }

    const totalEstimatedWords =
      sampleLimit > 0 && spineItems.length > sampleLimit
        ? Math.round((sampledWords / sampleLimit) * spineItems.length)
        : sampledWords;
    const pagesCount = Math.max(1, Math.round(totalEstimatedWords / 275) || spineItems.length || 1);

    const sampleText = sampleChunks.join("\n\n").slice(0, 8000);
    const language = detectLanguage(sampleText, rawLang);
    const category = detectCategory({ title, description: rawDesc, subjects, sampleText });
    const description = buildAutoDescription({
      embeddedDesc: rawDesc,
      title,
      author,
      sampleText,
      pages: pagesCount,
      language,
      category,
    });

    // Extract embedded EPUB cover image
    let coverFile: File | null = null;
    let coverSource: CoverSource = "epub-cover";
    try {
      const coverUrl = await book.coverUrl();
      if (coverUrl) {
        const resp = await fetch(coverUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          if (blob.size > 500) {
            const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
            const safeName = title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "book";
            coverFile = new File([blob], `${safeName}_cover.${ext}`, { type: blob.type || "image/jpeg" });
          }
        }
        if (coverUrl.startsWith("blob:")) URL.revokeObjectURL(coverUrl);
      }
    } catch {
      // Fallback below
    }

    if (!coverFile) {
      coverFile = await generateTypographicCoverFile({ title, author, category });
      coverSource = "generated";
    }
    const coverPreviewUrl = coverFile ? URL.createObjectURL(coverFile) : null;
    const duplicate = await checkBookDuplicate({ fileHash, title, author });

    return {
      title,
      author,
      category,
      language,
      description,
      pages: pagesCount,
      coverFile,
      coverPreviewUrl,
      coverSource,
      fileHash,
      duplicate,
      warnings,
    };
  } finally {
    try {
      book.destroy();
    } catch {
      /* ignore */
    }
  }
}

async function analyzeTextOrFallbackBook(
  file: File,
  buffer: ArrayBuffer,
  fileHash: string,
): Promise<BookAnalysisResult> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const filenameGuess = parseTitleAndAuthorFromFilename(file.name);
  const warnings: string[] = [];

  let rawText = "";
  if (ext === "txt") {
    rawText = new TextDecoder("utf-8", { fatal: false }).decode(buffer.slice(0, 250_000));
  } else {
    // MOBI/other: decode ASCII/UTF-8 readable segments for language/description hints
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(buffer.slice(0, 120_000));
    rawText = stripHtmlTags(decoded.replace(/[^\x20-\x7E\n\r\t\u00A0-\uFFFF]/g, " "));
    warnings.push("MOBI cover/page metadata limited — please review auto-detected details.");
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => cleanTextWhitespace(l))
    .filter(Boolean);

  let detectedTitle = filenameGuess.title;
  let detectedAuthor = filenameGuess.author;

  for (const line of lines.slice(0, 12)) {
    const titleMatch = /^title\s*:\s*(.+)$/i.exec(line);
    if (titleMatch && !isJunkMetadataValue(titleMatch[1])) detectedTitle = titleMatch[1];
    const authorMatch = /^(?:author|by)\s*[:\s]\s*(.+)$/i.exec(line);
    if (authorMatch && !isJunkMetadataValue(authorMatch[1])) detectedAuthor = authorMatch[1];
  }

  const title = detectedTitle || file.name.replace(/\.[^/.]+$/, "");
  const author = detectedAuthor || "Unknown Author";
  const wordCount = rawText.split(/\s+/).filter(Boolean).length;
  const pages = Math.max(1, Math.round(wordCount / 275) || Math.max(1, Math.round(file.size / 2500)));
  const sampleText = rawText.slice(0, 8000);
  const language = detectLanguage(sampleText, null);
  const category = detectCategory({ title, sampleText });
  const description = buildAutoDescription({
    title,
    author,
    sampleText,
    pages,
    language,
    category,
  });

  const coverFile = await generateTypographicCoverFile({ title, author, category });
  const coverPreviewUrl = coverFile ? URL.createObjectURL(coverFile) : null;
  const duplicate = await checkBookDuplicate({ fileHash, title, author });

  return {
    title,
    author,
    category,
    language,
    description,
    pages,
    coverFile,
    coverPreviewUrl,
    coverSource: "generated",
    fileHash,
    duplicate,
    warnings,
  };
}

/**
 * Fully inspects a book file (PDF, EPUB, TXT, MOBI) and returns verified cover, title,
 * author, category, language, description, exact/estimated pages, and duplicate status.
 */
export async function analyzeBookFile(file: File): Promise<BookAnalysisResult> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(digest);
  let fileHash = "";
  for (let i = 0; i < bytes.length; i++) {
    fileHash += bytes[i].toString(16).padStart(2, "0");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") {
    return analyzePdfBook(file, buffer, fileHash);
  }
  if (ext === "epub") {
    return analyzeEpubBook(file, buffer, fileHash);
  }
  return analyzeTextOrFallbackBook(file, buffer, fileHash);
}
