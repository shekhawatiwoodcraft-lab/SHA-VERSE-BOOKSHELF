import { del, get, keys, set } from "idb-keyval";
import { supabase } from "@/integrations/supabase/client";
import type {
  GeminiPrebuiltVoiceId,
  NarrationStyleId,
  TranslationQuality,
} from "@/lib/ai/languages";

export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface CachedBookTranslation {
  bookId: string;
  sourceLanguage: string;
  targetLanguage: string;
  quality: TranslationQuality;
  translatedMap: Record<string, string>;
  completedChapters: string[];
  failedChapters: string[];
  glossary: GlossaryEntry[];
  detectedSourceLanguage?: string;
  updatedAt: number;
}

export interface ListeningProgressRecord {
  bookId: string;
  bookTitle?: string;
  coverUrl?: string | null;
  language: string;
  chapterId: string;
  chapterTitle?: string;
  chapterIndex: number;
  blockId: string;
  blockIndex: number;
  sentenceIndex: number;
  playbackPosition: number;
  playbackSpeed: number;
  updatedAt: number;
}

export interface UserVoicePreferences {
  preferredTargetLanguage: string;
  preferredTtsLanguage: string;
  preferredVoice: GeminiPrebuiltVoiceId;
  preferredSecondaryVoice: GeminiPrebuiltVoiceId;
  preferredStyle: NarrationStyleId;
  preferredSpeed: number;
  dialogueMode: boolean;
  sleepTimerMinutes: number; // 0 = off, -1 = end of chapter
}

export const DEFAULT_VOICE_PREFERENCES: UserVoicePreferences = {
  preferredTargetLanguage: "hi",
  preferredTtsLanguage: "en",
  preferredVoice: "Kore",
  preferredSecondaryVoice: "Puck",
  preferredStyle: "natural",
  preferredSpeed: 1.0,
  dialogueMode: false,
  sleepTimerMinutes: 0,
};

const TRANSLATION_PREFIX = "shaverse:ai:translation:v1:";
const AUDIO_PREFIX = "shaverse:ai:audio:v1:";
const LISTEN_PREFIX = "shaverse:ai:listen:v1:";
const VOICE_PREFS_KEY = "shaverse:ai:voice-prefs:v1";
const DETECTED_LANG_PREFIX = "shaverse:ai:detected-lang:v1:";
const MAX_CACHED_AUDIO = 140;

interface DynamicTableQuery {
  select: (cols: string) => DynamicTableQuery;
  eq: (col: string, val: unknown) => DynamicTableQuery;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
  upsert: (values: Record<string, unknown>, opts?: { onConflict?: string }) => DynamicTableQuery;
  then?: Promise<{ data: Array<Record<string, unknown>> | null; error: unknown }>["then"];
}

const sbUntyped = supabase as unknown as {
  from: (table: string) => DynamicTableQuery;
};

async function safeGetUserAndToken(): Promise<{ userId: string | null; accessToken: string | null }> {
  try {
    const { data } = await supabase.auth.getSession();
    return {
      userId: data.session?.user?.id ?? null,
      accessToken: data.session?.access_token ?? null,
    };
  } catch {
    return { userId: null, accessToken: null };
  }
}

export async function getAuthTokenForAi(): Promise<string | null> {
  const { accessToken } = await safeGetUserAndToken();
  return accessToken;
}

/* ----------------------------- Detected Language ---------------------------- */

export async function loadDetectedLanguage(bookId: string): Promise<string | null> {
  try {
    return (await get<string>(`${DETECTED_LANG_PREFIX}${bookId}`)) ?? null;
  } catch {
    return null;
  }
}

export async function saveDetectedLanguage(bookId: string, languageCode: string): Promise<void> {
  try {
    await set(`${DETECTED_LANG_PREFIX}${bookId}`, languageCode);
  } catch {
    /* ignore */
  }
}

/* ------------------------------ Translations -------------------------------- */

function translationKey(bookId: string, targetLanguage: string, quality: TranslationQuality): string {
  return `${TRANSLATION_PREFIX}${bookId}:${targetLanguage}:${quality}`;
}

export async function loadCachedTranslation(
  bookId: string,
  targetLanguage: string,
  quality: TranslationQuality,
): Promise<CachedBookTranslation | null> {
  try {
    const local = await get<CachedBookTranslation>(translationKey(bookId, targetLanguage, quality));
    if (local) return local;
  } catch {
    /* ignore */
  }

  // Best-effort remote restore if IndexedDB was cleared
  try {
    const { userId } = await safeGetUserAndToken();
    if (!userId) return null;
    const { data: bt } = await sbUntyped
      .from("book_translations")
      .select("id, original_language, target_language, translation_quality, glossary, updated_at")
      .eq("user_id", userId)
      .eq("book_id", bookId)
      .eq("target_language", targetLanguage)
      .eq("translation_quality", quality)
      .maybeSingle();

    if (!bt?.id) return null;
    const { data: chapters } = await sbUntyped
      .from("translated_chapters")
      .select("original_chapter_id, translated_content, translation_status")
      .eq("translation_id", bt.id);

    const translatedMap: Record<string, string> = {};
    const completedChapters: string[] = [];
    if (Array.isArray(chapters)) {
      for (const ch of chapters) {
        if (ch.translation_status === "completed" && ch.original_chapter_id) {
          completedChapters.push(ch.original_chapter_id);
        }
        if (ch.translated_content && typeof ch.translated_content === "object") {
          Object.assign(translatedMap, ch.translated_content);
        }
      }
    }

    const restored: CachedBookTranslation = {
      bookId,
      sourceLanguage: bt.original_language || "en",
      targetLanguage: bt.target_language,
      quality: (bt.translation_quality as TranslationQuality) || quality,
      translatedMap,
      completedChapters,
      failedChapters: [],
      glossary: Array.isArray(bt.glossary) ? bt.glossary : [],
      updatedAt: Date.now(),
    };
    await set(translationKey(bookId, targetLanguage, quality), restored);
    return restored;
  } catch {
    return null;
  }
}

export async function saveCachedTranslation(record: CachedBookTranslation): Promise<void> {
  try {
    await set(translationKey(record.bookId, record.targetLanguage, record.quality), record);
  } catch {
    /* ignore quota errors */
  }
}

export async function syncTranslatedChapterRemote(params: {
  bookId: string;
  sourceLanguage: string;
  targetLanguage: string;
  quality: TranslationQuality;
  chapterId: string;
  chapterOrder: number;
  contentHash: string;
  chapterBlockMap: Record<string, string>;
  glossary: GlossaryEntry[];
  status: string;
}): Promise<void> {
  try {
    const { userId } = await safeGetUserAndToken();
    if (!userId) return;

    const { data: upserted } = await sbUntyped
      .from("book_translations")
      .upsert(
        {
          user_id: userId,
          book_id: params.bookId,
          original_language: params.sourceLanguage,
          target_language: params.targetLanguage,
          translation_quality: params.quality,
          translation_status: params.status,
          glossary: params.glossary.slice(0, 60),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,book_id,target_language,translation_quality" },
      )
      .select("id")
      .maybeSingle();

    if (!upserted?.id) return;

    await sbUntyped.from("translated_chapters").upsert(
      {
        translation_id: upserted.id,
        original_chapter_id: params.chapterId,
        chapter_order: params.chapterOrder,
        content_hash: params.contentHash,
        translated_content: params.chapterBlockMap,
        translation_status: "completed",
      },
      { onConflict: "translation_id,original_chapter_id,content_hash" },
    );
  } catch {
    // Graceful no-op if Supabase migration hasn't been applied remotely yet
  }
}

/* ------------------------------- Audio WAV Cache ---------------------------- */

interface CachedAudioEntry {
  blob: Blob;
  savedAt: number;
}

export async function loadCachedAudioSegment(contentHash: string): Promise<Blob | null> {
  try {
    const entry = await get<CachedAudioEntry>(`${AUDIO_PREFIX}${contentHash}`);
    return entry?.blob ?? null;
  } catch {
    return null;
  }
}

export async function saveCachedAudioSegment(contentHash: string, blob: Blob): Promise<void> {
  try {
    await set(`${AUDIO_PREFIX}${contentHash}`, { blob, savedAt: Date.now() } satisfies CachedAudioEntry);
    await trimAudioCache();
  } catch {
    /* ignore storage limits */
  }
}

async function trimAudioCache(): Promise<void> {
  try {
    const allKeys = (await keys()) as string[];
    const audioKeys = allKeys.filter((k) => typeof k === "string" && k.startsWith(AUDIO_PREFIX));
    if (audioKeys.length <= MAX_CACHED_AUDIO) return;

    const entries = await Promise.all(
      audioKeys.map(async (k) => ({ key: k, savedAt: (await get<CachedAudioEntry>(k))?.savedAt ?? 0 })),
    );
    entries
      .sort((a, b) => a.savedAt - b.savedAt)
      .slice(0, entries.length - MAX_CACHED_AUDIO)
      .forEach((e) => void del(e.key));
  } catch {
    /* ignore */
  }
}

/* ---------------------------- Listening Progress ---------------------------- */

export async function loadListeningProgress(bookId: string): Promise<ListeningProgressRecord | null> {
  try {
    const local = await get<ListeningProgressRecord>(`${LISTEN_PREFIX}${bookId}`);
    if (local) return local;
  } catch {
    /* ignore */
  }

  try {
    const { userId } = await safeGetUserAndToken();
    if (!userId) return null;
    const { data } = await sbUntyped
      .from("listening_progress")
      .select("*")
      .eq("user_id", userId)
      .eq("book_id", bookId)
      .maybeSingle();
    if (!data) return null;
    const restored: ListeningProgressRecord = {
      bookId,
      language: data.language || "en",
      chapterId: data.chapter_id || "",
      chapterIndex: 0,
      blockId: data.block_id || "",
      blockIndex: 0,
      sentenceIndex: Number(data.sentence_index || 0),
      playbackPosition: Number(data.playback_position || 0),
      playbackSpeed: Number(data.playback_speed || 1),
      updatedAt: Date.now(),
    };
    await set(`${LISTEN_PREFIX}${bookId}`, restored);
    return restored;
  } catch {
    return null;
  }
}

export async function saveListeningProgress(record: ListeningProgressRecord): Promise<void> {
  try {
    await set(`${LISTEN_PREFIX}${record.bookId}`, record);
  } catch {
    /* ignore */
  }

  try {
    const { userId } = await safeGetUserAndToken();
    if (!userId) return;
    await sbUntyped.from("listening_progress").upsert(
      {
        user_id: userId,
        book_id: record.bookId,
        language: record.language,
        chapter_id: record.chapterId,
        block_id: record.blockId,
        segment_id: `${record.blockId}_s${record.sentenceIndex}`,
        sentence_index: record.sentenceIndex,
        playback_position: record.playbackPosition,
        playback_speed: record.playbackSpeed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,book_id" },
    );
  } catch {
    /* graceful no-op if remote migration not applied */
  }
}

/* ----------------------------- Voice Preferences ---------------------------- */

export function loadVoicePreferencesSync(): UserVoicePreferences {
  if (typeof window === "undefined") return DEFAULT_VOICE_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(VOICE_PREFS_KEY);
    if (!raw) return DEFAULT_VOICE_PREFERENCES;
    return { ...DEFAULT_VOICE_PREFERENCES, ...(JSON.parse(raw) as Partial<UserVoicePreferences>) };
  } catch {
    return DEFAULT_VOICE_PREFERENCES;
  }
}

export function saveVoicePreferencesSync(prefs: UserVoicePreferences): void {
  try {
    window.localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }

  void (async () => {
    try {
      const { userId } = await safeGetUserAndToken();
      if (!userId) return;
      await sbUntyped.from("user_voice_preferences").upsert(
        {
          user_id: userId,
          preferred_target_language: prefs.preferredTargetLanguage,
          preferred_tts_language: prefs.preferredTtsLanguage,
          preferred_voice: prefs.preferredVoice,
          preferred_secondary_voice: prefs.preferredSecondaryVoice,
          preferred_style: prefs.preferredStyle,
          preferred_speed: prefs.preferredSpeed,
          dialogue_mode: prefs.dialogueMode,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    } catch {
      /* graceful no-op */
    }
  })();
}
