import express, { type Request, type Response } from "express";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import {
  SUPPORTED_LANGUAGES,
  VOICE_LIBRARY,
  NARRATION_STYLES,
  getLanguageMeta,
  type TranslationQuality,
  type GeminiPrebuiltVoiceId,
} from "./src/lib/ai/languages";
import {
  detectDialogueParts,
  parseModelJson,
  validateTranslationBatch,
} from "./src/lib/ai/segments";
import { resolveSupabaseConfig } from "./src/integrations/supabase/config";

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_ENABLED = true;
const resolvedSupabase = resolveSupabaseConfig({
  url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  key: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});
const SUPABASE_URL = SUPABASE_ENABLED ? resolvedSupabase.url : "";
const SUPABASE_ANON_KEY = SUPABASE_ENABLED ? resolvedSupabase.publishableKey : "";
const SUPABASE_AUTH_CONFIGURED = Boolean(SUPABASE_ENABLED && SUPABASE_URL && SUPABASE_ANON_KEY);

const FAST_TRANSLATION_MODEL = "gemini-3.1-flash-lite";
const TRANSLATION_MODEL = "gemini-4-hydrogen";
const TTS_STANDARD_MODEL = "gemini-3.8-flash-lite-tts";
const TTS_DIALOGUE_MODEL = "gemini-3.8-flash-tts";

// Server-side LRU caches (in-memory) + in-flight deduplication
const MAX_TRANSLATION_CACHE = 400;
const MAX_AUDIO_CACHE = 240;
const MAX_AUTH_CACHE = 500;
const AUTH_CACHE_TTL_MS = 120_000;

const translationCache = new Map<string, { items: Array<{ id: string; translatedText: string }>; glossaryAdditions: Array<{ source: string; target: string }> }>();
const audioCache = new Map<string, Buffer>();
const inflightTts = new Map<string, Promise<Buffer>>();
const inflightTranslations = new Map<string, Promise<{ items: Array<{ id: string; translatedText: string }>; glossaryAdditions: Array<{ source: string; target: string }> }>>();
const verifiedAuthCache = new Map<string, { callerId: string; expiresAt: number }>();

// Simple per-caller sliding-window rate limiter
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQ = 150;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX_REQ) return false;
  bucket.count += 1;
  return true;
}

function getGenAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") return null;
  return new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      timeout: 30_000,
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function setBoundedCache<K, V>(map: Map<K, V>, key: K, value: V, limit: number) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/**
 * Ensures TTS audio buffer has a valid RIFF/WAV container so browser <audio>
 * elements always decode cleanly even if provider returns raw PCM (audio/L16).
 */
function ensurePlayableWavBuffer(rawBuffer: Buffer, mimeType?: string): Buffer {
  if (
    rawBuffer.length >= 12 &&
    rawBuffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    rawBuffer.subarray(8, 12).toString("ascii") === "WAVE"
  ) {
    return rawBuffer;
  }
  const rateMatch = /rate=(\d+)/i.exec(mimeType || "");
  const sampleRate = rateMatch ? Math.max(8000, Math.min(96000, Number(rateMatch[1]))) : 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + rawBuffer.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(rawBuffer.length, 40);
  return Buffer.concat([header, rawBuffer]);
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 1): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const errName = (err as { name?: string })?.name || "";
      const errMsg = err instanceof Error ? err.message : String(err || "");
      if (errName === "AbortError" || /timeout|timed out|aborted/i.test(errMsg)) {
        break;
      }
      const status = Number((err as { status?: number })?.status || 0);
      // Fail fast on 429 so we don't stall UX or multiply upstream RPM load.
      if (status === 429 || /RESOURCE_EXHAUSTED|rate limit/i.test(errMsg)) break;
      const retryable = status >= 500;
      if (!retryable || attempt === maxRetries) break;
      await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 120)));
    }
  }
  throw lastErr;
}

async function verifyCallerAuth(req: Request): Promise<{ ok: boolean; callerId: string; status?: number; message?: string }> {
  const authHeader = req.headers.authorization || "";
  if (!SUPABASE_AUTH_CONFIGURED) {
    // Disconnected from legacy Supabase: identify caller safely for rate-limiting without calling external auth.
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const callerKey = token ? sha256(token).slice(0, 12) : `anon-${sha256(req.ip || "local").slice(0, 12)}`;
    return { ok: true, callerId: callerKey };
  }

  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, callerId: "anon", status: 401, message: "Authentication required for AI reading features." };
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return { ok: false, callerId: "anon", status: 401, message: "Missing authentication token." };
  }

  const tokenHash = sha256(token);
  const now = Date.now();
  const cached = verifiedAuthCache.get(tokenHash);
  if (cached && cached.expiresAt > now) {
    return { ok: true, callerId: cached.callerId };
  }
  if (cached) {
    verifiedAuthCache.delete(tokenHash);
  }

  // Verify token against configured Auth server when reachable
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (resp.ok) {
      const user = (await resp.json()) as { id?: string };
      const callerId = user.id || tokenHash.slice(0, 12);
      setBoundedCache(
        verifiedAuthCache,
        tokenHash,
        { callerId, expiresAt: now + AUTH_CACHE_TTL_MS },
        MAX_AUTH_CACHE,
      );
      return { ok: true, callerId };
    }
    if (resp.status === 401 || resp.status === 403) {
      verifiedAuthCache.delete(tokenHash);
      return { ok: false, callerId: "invalid", status: 401, message: "Session expired or invalid. Please sign in again." };
    }
  } catch {
    // Transient network drop to auth server: rate-limit by hashed token instead of failing offline-capable previews
  }
  return { ok: true, callerId: tokenHash.slice(0, 12) };
}

function mapAiError(err: unknown): { status: number; code: string; message: string } {
  const rawMsg = err instanceof Error ? err.message : String(err || "Unknown AI error");
  const status = Number((err as { status?: number })?.status || 0);
  if (status === 400 && /API_KEY_INVALID/i.test(rawMsg)) {
    return { status: 401, code: "API_KEY_INVALID", message: "Gemini API key is invalid. Please check Settings > Secrets." };
  }
  if (status === 403 || /PERMISSION_DENIED/i.test(rawMsg)) {
    return { status: 403, code: "PERMISSION_DENIED", message: "Gemini API permission denied. Please check your API key." };
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|rate limit/i.test(rawMsg)) {
    return { status: 429, code: "RATE_LIMITED", message: "AI service rate limit reached. Please wait a moment and retry." };
  }
  if (status === 404 || /NOT_FOUND/i.test(rawMsg)) {
    return { status: 502, code: "MODEL_NOT_FOUND", message: "Configured AI model is temporarily unavailable." };
  }
  return { status: 502, code: "AI_SERVICE_ERROR", message: rawMsg.slice(0, 220) };
}

const VALID_VOICES = new Set<GeminiPrebuiltVoiceId>(VOICE_LIBRARY.map((v) => v.id));

function normalizeVoice(v?: string): GeminiPrebuiltVoiceId {
  if (v && VALID_VOICES.has(v as GeminiPrebuiltVoiceId)) {
    return v as GeminiPrebuiltVoiceId;
  }
  return "Kore";
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // AI service health & capability advertisement (no secrets exposed)
  app.get("/api/ai/health", (_req: Request, res: Response) => {
    const configured = Boolean(getGenAiClient());
    res.json({
      configured,
      models: {
        translation: FAST_TRANSLATION_MODEL,
        tts: TTS_STANDARD_MODEL,
        dialogueTts: TTS_DIALOGUE_MODEL,
      },
      limits: {
        maxBlocksPerTranslateBatch: 16,
        maxCharsPerTtsSegment: 1600,
      },
    });
  });

  app.get("/api/ai/voices", (_req: Request, res: Response) => {
    res.json({
      voices: VOICE_LIBRARY,
      styles: NARRATION_STYLES,
      languages: SUPPORTED_LANGUAGES,
    });
  });

  app.post("/api/ai/detect-language", async (req: Request, res: Response) => {
    const auth = await verifyCallerAuth(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.message });
    if (!checkRateLimit(auth.callerId)) {
      return res.status(429).json({ error: "Too many requests. Please slow down.", code: "RATE_LIMITED" });
    }

    const ai = getGenAiClient();
    if (!ai) {
      return res.status(503).json({
        error: "AI service requires a GEMINI_API_KEY configured in Settings > Secrets.",
        code: "AI_NOT_CONFIGURED",
      });
    }

    const sampleText = typeof req.body?.sampleText === "string" ? req.body.sampleText.trim().slice(0, 2200) : "";
    if (!sampleText) {
      return res.status(400).json({ error: "sampleText is required." });
    }

    try {
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: FAST_TRANSLATION_MODEL,
          contents: `Detect the primary language of this book excerpt and return its ISO 639-1 code (e.g., en, hi, ur, ar, bn, es, fr, de, pt, zh, ja, ko, ru, tr, id).\n\nExcerpt:\n${sampleText}`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                languageCode: { type: Type.STRING },
                languageName: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
              },
              required: ["languageCode", "languageName", "confidence"],
            },
          },
        }),
      );

      const parsed = parseModelJson<{
        languageCode?: string;
        languageName?: string;
        confidence?: number;
      }>(response.text || "{}");
      const meta = getLanguageMeta(parsed.languageCode || "en");
      res.json({
        languageCode: meta.code,
        languageName: parsed.languageName || meta.name,
        nativeName: meta.nativeName,
        dir: meta.dir,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.9,
      });
    } catch (err) {
      const mapped = mapAiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.post("/api/ai/translate", async (req: Request, res: Response) => {
    const auth = await verifyCallerAuth(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.message });
    if (!checkRateLimit(auth.callerId)) {
      return res.status(429).json({ error: "Too many translation requests. Please wait a moment.", code: "RATE_LIMITED" });
    }

    const ai = getGenAiClient();
    if (!ai) {
      return res.status(503).json({
        error: "AI translation requires a GEMINI_API_KEY configured in Settings > Secrets.",
        code: "AI_NOT_CONFIGURED",
      });
    }

    const {
      bookTitle = "",
      sourceLanguage = "en",
      targetLanguage,
      quality = "high",
      blocks,
      previousContext = [],
      glossary = [],
    } = (req.body || {}) as {
      bookTitle?: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      quality?: TranslationQuality;
      blocks?: Array<{ id: string; type?: string; text: string }>;
      previousContext?: string[];
      glossary?: Array<{ source: string; target: string }>;
    };

    if (!targetLanguage || typeof targetLanguage !== "string") {
      return res.status(400).json({ error: "targetLanguage is required." });
    }
    if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > 20) {
      return res.status(400).json({ error: "blocks must be a non-empty array of up to 20 paragraphs." });
    }

    const sanitizedBlocks = blocks.map((b) => ({
      id: String(b.id || ""),
      type: String(b.type || "paragraph"),
      text: String(b.text || "").slice(0, 6000),
    }));

    const totalChars = sanitizedBlocks.reduce((acc, b) => acc + b.text.length, 0);
    if (totalChars > 24_000) {
      return res.status(400).json({ error: "Translation batch exceeds maximum character limit (24,000)." });
    }

    const srcMeta = getLanguageMeta(sourceLanguage);
    const tgtMeta = getLanguageMeta(targetLanguage);
    const useLiteraryModel = quality === "literary" && sanitizedBlocks.length > 1;
    const selectedModel = useLiteraryModel ? TRANSLATION_MODEL : FAST_TRANSLATION_MODEL;
    const cacheKey = sha256(
      JSON.stringify({
        m: selectedModel,
        src: srcMeta.code,
        tgt: tgtMeta.code,
        q: quality,
        g: glossary.slice(0, 40),
        blocks: sanitizedBlocks,
      }),
    );

    const cached = translationCache.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, targetLanguage: tgtMeta.code, dir: tgtMeta.dir, cached: true });
    }

    let pending = inflightTranslations.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const thinkingLevel = useLiteraryModel ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL;

        const qualityInstruction =
          quality === "literary"
            ? "Prioritize literary flow, natural storytelling tone, idioms, cultural nuance, and dialogue voice in the target language while remaining faithful to the author's meaning."
            : quality === "high"
              ? "Prioritize natural grammar, context-aware phrasing, technical/historical accuracy, and consistent terminology."
              : "Prioritize clear, accurate, concise translation preserving exact paragraph structure.";

        const glossaryText =
          Array.isArray(glossary) && glossary.length > 0
            ? glossary
                .slice(0, 30)
                .map((g) => `- "${g.source}" -> "${g.target}"`)
                .join("\n")
            : "";

        const contextText =
          Array.isArray(previousContext) && previousContext.length > 0
            ? previousContext.slice(-2).join("\n")
            : "";

        const systemInstruction = [
          `You are a professional literary and technical book translator translating from ${srcMeta.name} (${srcMeta.code}) into ${tgtMeta.name} (${tgtMeta.nativeName}, ${tgtMeta.code}).`,
          qualityInstruction,
          "Strict rules:",
          "1. Return a 1-to-1 translation for every item id provided, in exact order, without merging, splitting, skipping, or inventing sentences.",
          "2. Keep character names consistent with the glossary; do not randomly localize established proper nouns unless standard.",
          "3. Preserve numbers, dates, citations, footnote markers, and punctuation naturally in the target script.",
          tgtMeta.dir === "rtl"
            ? `4. Format all ${tgtMeta.name} prose cleanly for right-to-left (RTL) reading.`
            : `4. Format all ${tgtMeta.name} prose cleanly for left-to-right (LTR) reading.`,
        ].join("\n");

        const userPrompt = [
          bookTitle ? `Book title: ${bookTitle}` : "",
          glossaryText ? `Approved Glossary:\n${glossaryText}` : "",
          contextText ? `Preceding Context (reference only, do not include in output):\n${contextText}` : "",
          `Segments to translate (JSON):\n${JSON.stringify(sanitizedBlocks)}`,
        ]
          .filter(Boolean)
          .join("\n\n");

        const response = await withRetry(() =>
          ai.models.generateContent({
            model: selectedModel,
            contents: userPrompt,
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel },
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        translatedText: { type: Type.STRING },
                      },
                      required: ["id", "translatedText"],
                    },
                  },
                  glossaryAdditions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        source: { type: Type.STRING },
                        target: { type: Type.STRING },
                      },
                      required: ["source", "target"],
                    },
                  },
                },
                required: ["items", "glossaryAdditions"],
              },
            },
          }),
        );

        const parsed = parseModelJson<{
          items?: Array<{ id: string; translatedText: string }>;
          glossaryAdditions?: Array<{ source: string; target: string }>;
        }>(response.text || "{}");

        const items = Array.isArray(parsed.items) ? parsed.items : [];
        const check = validateTranslationBatch(
          sanitizedBlocks.map((b) => ({ id: b.id, text: b.text })),
          items,
        );
        if (!check.valid) {
          throw new Error(check.error || "Incomplete translation batch returned.");
        }

        const result = {
          items: sanitizedBlocks.map((b) => ({ id: b.id, translatedText: check.map[b.id] })),
          glossaryAdditions: Array.isArray(parsed.glossaryAdditions) ? parsed.glossaryAdditions.slice(0, 12) : [],
        };
        setBoundedCache(translationCache, cacheKey, result, MAX_TRANSLATION_CACHE);
        return result;
      })();

      inflightTranslations.set(cacheKey, pending);
    }

    try {
      const result = await pending;
      res.json({ ...result, targetLanguage: tgtMeta.code, dir: tgtMeta.dir, cached: false });
    } catch (err) {
      const mapped = mapAiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    } finally {
      inflightTranslations.delete(cacheKey);
    }
  });

  app.post("/api/ai/tts", async (req: Request, res: Response) => {
    const auth = await verifyCallerAuth(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.message });
    if (!checkRateLimit(auth.callerId)) {
      return res.status(429).json({ error: "Too many audio generation requests. Please pause briefly.", code: "RATE_LIMITED" });
    }

    const ai = getGenAiClient();
    if (!ai) {
      return res.status(503).json({
        error: "AI audiobook narration requires a GEMINI_API_KEY configured in Settings > Secrets.",
        code: "AI_NOT_CONFIGURED",
      });
    }

    const {
      text,
      language = "en",
      voiceId = "Kore",
      secondaryVoiceId,
      style = "natural",
      dialogueMode = false,
    } = (req.body || {}) as {
      text?: string;
      language?: string;
      voiceId?: string;
      secondaryVoiceId?: string;
      style?: string;
      dialogueMode?: boolean;
    };

    const cleanText = typeof text === "string" ? text.trim().slice(0, 1800) : "";
    if (!cleanText) {
      return res.status(400).json({ error: "text is required for speech generation." });
    }

    const langMeta = getLanguageMeta(language);
    const primaryVoice = normalizeVoice(voiceId);
    const altVoice = secondaryVoiceId && secondaryVoiceId !== primaryVoice
      ? normalizeVoice(secondaryVoiceId)
      : primaryVoice === "Kore"
        ? "Puck"
        : "Kore";

    const styleObj = NARRATION_STYLES.find((s) => s.id === style) ?? NARRATION_STYLES[0];
    const dialogueParts = dialogueMode ? detectDialogueParts(cleanText) : [];
    const useMultiSpeaker = Boolean(
      dialogueMode &&
        dialogueParts.some((p) => p.speaker === "Speaker") &&
        dialogueParts.some((p) => p.speaker === "Narrator"),
    );

    const cacheKey = sha256(
      JSON.stringify({
        m: useMultiSpeaker ? TTS_DIALOGUE_MODEL : TTS_STANDARD_MODEL,
        lang: langMeta.code,
        v: primaryVoice,
        v2: useMultiSpeaker ? altVoice : "",
        st: styleObj.id,
        t: cleanText,
      }),
    );

    const cachedAudio = audioCache.get(cacheKey);
    if (cachedAudio) {
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("X-Audio-Cache", "HIT");
      return res.send(cachedAudio);
    }

    let pending = inflightTts.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const stylePrompt = `${styleObj.promptHint} in ${langMeta.name} (${langMeta.nativeName})`;
        let response;

        if (useMultiSpeaker) {
          const parts = dialogueParts.map((part) => ({
            text: `${part.speaker}: ${part.text}`,
            speechMetadata: {
              speaker: part.speaker,
              style:
                part.speaker === "Speaker"
                  ? `Expressive character dialogue voice in ${langMeta.name}`
                  : stylePrompt,
            },
          }));

          response = await withRetry(() =>
            ai.models.generateContent({
              model: TTS_DIALOGUE_MODEL,
              contents: [{ role: "user", parts }],
              config: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  multiSpeakerVoiceConfig: {
                    speakerVoiceConfigs: [
                      {
                        speaker: "Narrator",
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: primaryVoice } },
                      },
                      {
                        speaker: "Speaker",
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: altVoice } },
                      },
                    ],
                  },
                },
              },
            }),
          );
        } else {
          response = await withRetry(() =>
            ai.models.generateContent({
              model: TTS_STANDARD_MODEL,
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      text: cleanText,
                      speechMetadata: {
                        style: stylePrompt,
                      },
                    },
                  ],
                },
              ],
              config: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: primaryVoice },
                  },
                },
              },
            }),
          );
        }

        const inline = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        const base64Audio = inline?.data;
        if (!base64Audio) {
          throw new Error("TTS provider returned no audio data for this segment.");
        }
        const wavBuffer = ensurePlayableWavBuffer(Buffer.from(base64Audio, "base64"), inline?.mimeType);
        setBoundedCache(audioCache, cacheKey, wavBuffer, MAX_AUDIO_CACHE);
        return wavBuffer;
      })();

      inflightTts.set(cacheKey, pending);
    }

    try {
      const wavBuffer = await pending;
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("X-Audio-Cache", "MISS");
      res.send(wavBuffer);
    } catch (err) {
      const mapped = mapAiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    } finally {
      inflightTts.delete(cacheKey);
    }
  });

  app.post("/api/ai/tts/preview", async (req: Request, res: Response) => {
    const auth = await verifyCallerAuth(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.message });
    if (!checkRateLimit(auth.callerId)) {
      return res.status(429).json({ error: "Too many preview requests.", code: "RATE_LIMITED" });
    }

    const ai = getGenAiClient();
    if (!ai) {
      return res.status(503).json({
        error: "Voice previews require GEMINI_API_KEY configured in Settings > Secrets.",
        code: "AI_NOT_CONFIGURED",
      });
    }

    const {
      language = "en",
      voiceId = "Kore",
      style = "natural",
      sampleText: requestedSample,
    } = (req.body || {}) as {
      language?: string;
      voiceId?: string;
      style?: string;
      sampleText?: string;
    };
    const langMeta = getLanguageMeta(language);
    const primaryVoice = normalizeVoice(voiceId);
    const styleObj = NARRATION_STYLES.find((s) => s.id === style) ?? NARRATION_STYLES[0];
    const cleanSample =
      typeof requestedSample === "string" && requestedSample.trim().length > 0
        ? requestedSample.trim().slice(0, 260)
        : langMeta.previewPhrase;
    const cacheKey = sha256(
      `preview:${TTS_STANDARD_MODEL}:${langMeta.code}:${primaryVoice}:${styleObj.id}:${cleanSample}`,
    );

    const cached = audioCache.get(cacheKey);
    if (cached) {
      res.setHeader("Content-Type", "audio/wav");
      return res.send(cached);
    }

    let pending = inflightTts.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const response = await withRetry(() =>
          ai.models.generateContent({
            model: TTS_STANDARD_MODEL,
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: cleanSample,
                    speechMetadata: {
                      style: `${styleObj.promptHint} in ${langMeta.name}`,
                    },
                  },
                ],
              },
            ],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: primaryVoice },
                },
              },
            },
          }),
        );

        const inline = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        const base64Audio = inline?.data;
        if (!base64Audio) {
          throw new Error("Unable to generate voice preview.");
        }
        const wavBuffer = ensurePlayableWavBuffer(Buffer.from(base64Audio, "base64"), inline?.mimeType);
        setBoundedCache(audioCache, cacheKey, wavBuffer, MAX_AUDIO_CACHE);
        return wavBuffer;
      })();

      inflightTts.set(cacheKey, pending);
    }

    try {
      const wavBuffer = await pending;
      res.setHeader("Content-Type", "audio/wav");
      res.send(wavBuffer);
    } catch (err) {
      const mapped = mapAiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    } finally {
      inflightTts.delete(cacheKey);
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.use((req: Request, res: Response, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
      const indexHtml = path.join(distDir, "index.html");
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send("Build not found");
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SHA-VERSE Server] Listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
