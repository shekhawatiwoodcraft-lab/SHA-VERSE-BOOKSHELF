import { getAuthTokenForAi } from "@/lib/ai/cache";
import type {
  GeminiPrebuiltVoiceId,
  NarrationStyleId,
  TranslationQuality,
  VoiceProfile,
} from "@/lib/ai/languages";

export class AiServiceError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = "AI_SERVICE_ERROR") {
    super(message);
    this.name = "AiServiceError";
    this.status = status;
    this.code = code;
  }
}

export interface AiHealthStatus {
  configured: boolean;
  models: {
    translation: string;
    tts: string;
    dialogueTts: string;
  };
  limits: {
    maxBlocksPerTranslateBatch: number;
    maxCharsPerTtsSegment: number;
  };
}

export interface LanguageDetectionResult {
  languageCode: string;
  languageName: string;
  nativeName: string;
  dir: "ltr" | "rtl";
  confidence: number;
}

export interface TranslationBatchResponse {
  items: Array<{ id: string; translatedText: string }>;
  glossaryAdditions: Array<{ source: string; target: string }>;
  targetLanguage: string;
  dir: "ltr" | "rtl";
  cached?: boolean;
}

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getAuthTokenForAi();
  const headers: Record<string, string> = {
    ...(extra || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function parseErrorResponse(res: Response): Promise<AiServiceError> {
  try {
    const data = (await res.json()) as { error?: string; code?: string };
    return new AiServiceError(
      data.error || `Request failed with status ${res.status}`,
      res.status,
      data.code || (res.status === 503 ? "AI_NOT_CONFIGURED" : "AI_SERVICE_ERROR"),
    );
  } catch {
    return new AiServiceError(`Request failed with status ${res.status}`, res.status, "AI_SERVICE_ERROR");
  }
}

export async function fetchAiHealth(signal?: AbortSignal): Promise<AiHealthStatus> {
  const res = await fetch("/api/ai/health", { signal });
  if (!res.ok) throw await parseErrorResponse(res);
  return (await res.json()) as AiHealthStatus;
}

export async function fetchAiVoices(signal?: AbortSignal): Promise<{ voices: VoiceProfile[] }> {
  const res = await fetch("/api/ai/voices", { signal });
  if (!res.ok) throw await parseErrorResponse(res);
  return (await res.json()) as { voices: VoiceProfile[] };
}

export async function detectBookLanguage(
  sampleText: string,
  signal?: AbortSignal,
): Promise<LanguageDetectionResult> {
  const headers = await authHeaders({ "Content-Type": "application/json" });
  const res = await fetch("/api/ai/detect-language", {
    method: "POST",
    headers,
    body: JSON.stringify({ sampleText }),
    signal,
  });
  if (!res.ok) throw await parseErrorResponse(res);
  return (await res.json()) as LanguageDetectionResult;
}

export async function translateBookBatch(params: {
  bookTitle?: string;
  sourceLanguage: string;
  targetLanguage: string;
  quality: TranslationQuality;
  blocks: Array<{ id: string; type: string; text: string }>;
  previousContext?: string[];
  glossary?: Array<{ source: string; target: string }>;
  signal?: AbortSignal;
}): Promise<TranslationBatchResponse> {
  const headers = await authHeaders({ "Content-Type": "application/json" });
  const res = await fetch("/api/ai/translate", {
    method: "POST",
    headers,
    body: JSON.stringify({
      bookTitle: params.bookTitle,
      sourceLanguage: params.sourceLanguage,
      targetLanguage: params.targetLanguage,
      quality: params.quality,
      blocks: params.blocks,
      previousContext: params.previousContext,
      glossary: params.glossary,
    }),
    signal: params.signal,
  });
  if (!res.ok) throw await parseErrorResponse(res);
  return (await res.json()) as TranslationBatchResponse;
}

export async function generateSpeechWav(params: {
  text: string;
  language: string;
  voiceId: GeminiPrebuiltVoiceId;
  secondaryVoiceId?: GeminiPrebuiltVoiceId;
  style: NarrationStyleId;
  dialogueMode?: boolean;
  signal?: AbortSignal;
}): Promise<Blob> {
  const headers = await authHeaders({ "Content-Type": "application/json" });
  const res = await fetch("/api/ai/tts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      text: params.text,
      language: params.language,
      voiceId: params.voiceId,
      secondaryVoiceId: params.secondaryVoiceId,
      style: params.style,
      dialogueMode: Boolean(params.dialogueMode),
    }),
    signal: params.signal,
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const buf = await res.arrayBuffer();
  return new Blob([buf], { type: "audio/wav" });
}

export async function generateVoicePreviewWav(params: {
  language: string;
  voiceId: GeminiPrebuiltVoiceId;
  style: NarrationStyleId;
  sampleText?: string;
  signal?: AbortSignal;
}): Promise<Blob> {
  const headers = await authHeaders({ "Content-Type": "application/json" });
  const res = await fetch("/api/ai/tts/preview", {
    method: "POST",
    headers,
    body: JSON.stringify({
      language: params.language,
      voiceId: params.voiceId,
      style: params.style,
      sampleText: params.sampleText,
    }),
    signal: params.signal,
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const buf = await res.arrayBuffer();
  return new Blob([buf], { type: "audio/wav" });
}
