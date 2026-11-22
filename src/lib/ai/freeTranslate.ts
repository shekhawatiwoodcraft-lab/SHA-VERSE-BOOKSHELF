import { getLanguageMeta } from "./languages";

export interface FreeTranslateBlockInput {
  id: string;
  type?: string;
  text: string;
}

export interface FreeTranslateBatchResult {
  items: Array<{ id: string; translatedText: string }>;
  detectedSourceLanguage: string;
  provider: "free_gtx" | "mymemory";
}

/**
 * Zero-network script heuristic for instant fallback language detection
 * when AI detection is unconfigured or offline.
 */
export function detectScriptLanguage(sampleText: string): {
  languageCode: string;
  confidence: number;
} {
  const sample = (sampleText || "").trim();
  if (!sample) return { languageCode: "en", confidence: 0.5 };

  const counts: Array<{ code: string; regex: RegExp }> = [
    { code: "hi", regex: /[\u0900-\u097F]/g }, // Devanagari
    { code: "bn", regex: /[\u0980-\u09FF]/g }, // Bengali
    { code: "pa", regex: /[\u0A00-\u0A7F]/g }, // Gurmukhi
    { code: "gu", regex: /[\u0A80-\u0AFF]/g }, // Gujarati
    { code: "ta", regex: /[\u0B80-\u0BFF]/g }, // Tamil
    { code: "te", regex: /[\u0C00-\u0C7F]/g }, // Telugu
    { code: "kn", regex: /[\u0C80-\u0CFF]/g }, // Kannada
    { code: "ml", regex: /[\u0D00-\u0D7F]/g }, // Malayalam
    { code: "th", regex: /[\u0E00-\u0E7F]/g }, // Thai
    { code: "ja", regex: /[\u3040-\u30FF]/g }, // Hiragana/Katakana
    { code: "ko", regex: /[\uAC00-\uD7AF\u1100-\u11FF]/g }, // Hangul
    { code: "zh", regex: /[\u4E00-\u9FFF]/g }, // CJK Han
    { code: "ru", regex: /[\u0400-\u04FF]/g }, // Cyrillic
    { code: "el", regex: /[\u0370-\u03FF]/g }, // Greek
    { code: "he", regex: /[\u0590-\u05FF]/g }, // Hebrew
  ];

  // Arabic vs Urdu/Persian heuristics (Urdu uses ٹ ڈ ڑ ے ہ پ چ ژ گ ک)
  const arabicMatches = sample.match(/[\u0600-\u06FF\u0750-\u077F]/g);
  if (arabicMatches && arabicMatches.length >= 4) {
    const urduHints = sample.match(/[ٹڈڑئےہپچژگکں]/g);
    if (urduHints && urduHints.length >= 2) {
      return { languageCode: "ur", confidence: 0.9 };
    }
    const persianHints = sample.match(/[پچژگک]/g);
    if (persianHints && persianHints.length >= 2) {
      return { languageCode: "fa", confidence: 0.85 };
    }
    return { languageCode: "ar", confidence: 0.88 };
  }

  let bestCode = "en";
  let bestCount = 0;
  for (const entry of counts) {
    const m = sample.match(entry.regex);
    const n = m ? m.length : 0;
    if (n > bestCount) {
      bestCount = n;
      bestCode = entry.code;
    }
  }

  if (bestCount >= 3) {
    return { languageCode: bestCode, confidence: 0.9 };
  }

  // Basic Latin diacritic / common word hints
  const lower = sample.toLowerCase();
  if (/[ñ¿¡]/.test(lower) || /\b(que|para|como|pero|libro|capítulo)\b/.test(lower)) {
    return { languageCode: "es", confidence: 0.72 };
  }
  if (/[çœæ]/.test(lower) || /\b(dans|avec|pour|mais|livre|chapitre)\b/.test(lower)) {
    return { languageCode: "fr", confidence: 0.72 };
  }
  if (/[äöüß]/.test(lower) || /\b(und|der|die|das|nicht|kapitel)\b/.test(lower)) {
    return { languageCode: "de", confidence: 0.72 };
  }

  return { languageCode: "en", confidence: 0.8 };
}

/**
 * Splits a long block cleanly into chunks <= maxChars at sentence/whitespace boundaries.
 */
export function chunkTextForFreeTranslate(text: string, maxChars = 1400): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < clean.length) {
    if (cursor + maxChars >= clean.length) {
      chunks.push(clean.slice(cursor).trim());
      break;
    }
    const slice = clean.slice(cursor, cursor + maxChars);
    let splitAt = Math.max(
      slice.lastIndexOf(". "),
      slice.lastIndexOf("। "),
      slice.lastIndexOf("؟ "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? "),
      slice.lastIndexOf("\n"),
    );
    if (splitAt < maxChars * 0.45) {
      splitAt = slice.lastIndexOf(" ");
    }
    if (splitAt < maxChars * 0.25) {
      splitAt = maxChars;
    } else {
      splitAt += 1;
    }
    const piece = clean.slice(cursor, cursor + splitAt).trim();
    if (piece) chunks.push(piece);
    cursor += splitAt;
  }
  return chunks;
}

function toProviderLangCode(code: string): string {
  const normalized = getLanguageMeta(code).code;
  if (normalized === "zh") return "zh-CN";
  if (normalized === "he") return "iw";
  if (normalized === "jv") return "jw";
  return normalized;
}

async function fetchWithTimeout(url: string, timeoutMs = 9000): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        "User-Agent": "Sha-Verse-Bookshelf/1.0",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function translateSingleTextFreeGtx(params: {
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
}): Promise<{ translatedText: string; detectedSource: string }> {
  const sl = params.sourceLanguage && params.sourceLanguage !== "auto"
    ? toProviderLangCode(params.sourceLanguage)
    : "auto";
  const tl = toProviderLangCode(params.targetLanguage);
  const chunks = chunkTextForFreeTranslate(params.text, 1400);
  if (chunks.length === 0) {
    return { translatedText: "", detectedSource: sl === "auto" ? "en" : sl };
  }

  const outParts: string[] = [];
  let detected = sl === "auto" ? "en" : sl;

  for (const chunk of chunks) {
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx` +
      `&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(chunk)}`;

    const resp = await fetchWithTimeout(url, 9000);
    if (!resp.ok) {
      throw new Error(`Free translation endpoint returned status ${resp.status}`);
    }
    const payload = (await resp.json()) as [
      Array<[string | null, string | null, ...unknown[]]>,
      unknown,
      string?,
    ];
    const segments = Array.isArray(payload?.[0]) ? payload[0] : [];
    const translatedChunk = segments
      .map((seg) => (Array.isArray(seg) && typeof seg[0] === "string" ? seg[0] : ""))
      .join("")
      .trim();
    if (!translatedChunk) {
      throw new Error("Empty translation segment returned from free provider.");
    }
    if (typeof payload?.[2] === "string" && payload[2].trim()) {
      detected = payload[2].trim().split("-")[0];
    }
    outParts.push(translatedChunk);
  }

  return {
    translatedText: outParts.join(" ").replace(/\s+/g, " ").trim(),
    detectedSource: detected,
  };
}

export async function translateSingleTextMyMemory(params: {
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
}): Promise<{ translatedText: string; detectedSource: string }> {
  const detectedLocal =
    !params.sourceLanguage || params.sourceLanguage === "auto"
      ? detectScriptLanguage(params.text).languageCode
      : params.sourceLanguage;
  const sl = toProviderLangCode(detectedLocal);
  const tl = toProviderLangCode(params.targetLanguage);

  const chunks = chunkTextForFreeTranslate(params.text, 460);
  if (chunks.length === 0) {
    return { translatedText: "", detectedSource: sl };
  }

  const outParts: string[] = [];
  for (const chunk of chunks) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent(`${sl}|${tl}`)}`;
    const resp = await fetchWithTimeout(url, 9000);
    if (!resp.ok) {
      throw new Error(`MyMemory returned status ${resp.status}`);
    }
    const data = (await resp.json()) as {
      responseStatus?: number;
      responseData?: { translatedText?: string };
    };
    const translated = data?.responseData?.translatedText?.trim();
    if (!translated || (data.responseStatus && data.responseStatus >= 400)) {
      throw new Error("MyMemory translation unavailable for this language pair.");
    }
    outParts.push(translated);
  }

  return {
    translatedText: outParts.join(" ").replace(/\s+/g, " ").trim(),
    detectedSource: sl.split("-")[0],
  };
}

export async function translateBlocksFree(params: {
  blocks: FreeTranslateBlockInput[];
  sourceLanguage?: string;
  targetLanguage: string;
}): Promise<FreeTranslateBatchResult> {
  const { blocks, sourceLanguage = "auto", targetLanguage } = params;
  const results: Array<{ id: string; translatedText: string }> = new Array(blocks.length);
  let detectedSourceLanguage = sourceLanguage === "auto" ? "en" : getLanguageMeta(sourceLanguage).code;
  let usedProvider: "free_gtx" | "mymemory" = "free_gtx";

  // Bounded concurrency of 3 keeps batch speed fast without triggering free endpoint throttling.
  let nextIdx = 0;
  const workerCount = Math.min(3, Math.max(1, blocks.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIdx < blocks.length) {
      const idx = nextIdx++;
      const block = blocks[idx];
      const clean = (block.text || "").trim();
      if (!clean) {
        results[idx] = { id: block.id, translatedText: "" };
        continue;
      }

      if (sourceLanguage !== "auto" && getLanguageMeta(sourceLanguage).code === getLanguageMeta(targetLanguage).code) {
        results[idx] = { id: block.id, translatedText: clean };
        continue;
      }

      try {
        const gtx = await translateSingleTextFreeGtx({
          text: clean,
          sourceLanguage,
          targetLanguage,
        });
        results[idx] = { id: block.id, translatedText: gtx.translatedText };
        if (gtx.detectedSource) detectedSourceLanguage = gtx.detectedSource;
      } catch {
        const mm = await translateSingleTextMyMemory({
          text: clean,
          sourceLanguage,
          targetLanguage,
        });
        usedProvider = "mymemory";
        results[idx] = { id: block.id, translatedText: mm.translatedText };
        if (mm.detectedSource) detectedSourceLanguage = mm.detectedSource;
      }
    }
  });

  await Promise.all(workers);

  return {
    items: results,
    detectedSourceLanguage,
    provider: usedProvider,
  };
}
