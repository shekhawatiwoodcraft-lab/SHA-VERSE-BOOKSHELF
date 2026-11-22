import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Chapter, ReflowBook } from "@/lib/reader/types";
import {
  buildChapterAudioSegments,
  buildPageAudioSegments,
  buildSelectionAudioSegments,
  getChapterBlockRange,
  resolveBookChapters,
  resolveChapterAndBlockIndex,
  type AudioSegment,
} from "@/lib/ai/segments";
import {
  loadCachedAudioSegment,
  loadVoicePreferencesSync,
  saveCachedAudioSegment,
  saveListeningProgress,
  saveVoicePreferencesSync,
  type AudioEnginePreference,
  type ListeningProgressRecord,
  type UserVoicePreferences,
} from "@/lib/ai/cache";
import { AiServiceError, generateSpeechWav } from "@/lib/ai/client";
import type { GeminiPrebuiltVoiceId, NarrationStyleId } from "@/lib/ai/languages";
import {
  isWebSpeechSupported,
  listBrowserVoicesForLanguage,
  WebSpeechController,
  type BrowserVoiceInfo,
} from "@/lib/ai/webSpeechTts";

export type AudiobookStatus = "idle" | "loading" | "playing" | "paused" | "error";
export type AudiobookScope = "selection" | "paragraph" | "page" | "chapter" | "book";

export interface AudiobookStartInput {
  bookId: string;
  bookTitle: string;
  author?: string;
  coverUrl?: string | null;
  reflowBook: ReflowBook;
  language: string;
  translatedMap?: Record<string, string>;
  chapterIndex?: number;
  chapterId?: string;
  startBlockId?: string;
  startSentenceIndex?: number;
  startPositionSec?: number;
  scope?: AudiobookScope;
  page?: number;
}

export interface SelectionPlaybackInput {
  bookId: string;
  bookTitle: string;
  author?: string;
  coverUrl?: string | null;
  reflowBook: ReflowBook;
  text: string;
  language: string;
  blockId?: string;
  blockIndex?: number;
  chapterId?: string;
  chapterTitle?: string;
  page?: number;
}

export interface PagePlaybackInput {
  bookId: string;
  bookTitle: string;
  author?: string;
  coverUrl?: string | null;
  reflowBook: ReflowBook;
  page: number;
  language: string;
  translatedMap?: Record<string, string>;
  fallbackStartBlockIndex?: number;
}

export interface AudiobookSession {
  bookId: string;
  bookTitle: string;
  author?: string;
  coverUrl?: string | null;
  reflowBook: ReflowBook;
  chapters: Chapter[];
  currentChapterIndex: number;
  currentPage: number;
  scope: AudiobookScope;
  language: string;
  translatedMap?: Record<string, string>;
  segments: AudioSegment[];
  currentSegmentIndex: number;
}

interface AudiobookContextValue {
  session: AudiobookSession | null;
  status: AudiobookStatus;
  activeEngine: "ai" | "browser";
  availableBrowserVoices: BrowserVoiceInfo[];
  error: string | null;
  errorCode: string | null;
  preferences: UserVoicePreferences;
  isMinimized: boolean;
  isDrawerOpen: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  sleepRemainingSec: number | null;
  activeSegment: AudioSegment | null;
  startBookPlayback: (input: AudiobookStartInput) => Promise<void>;
  startPagePlayback: (input: PagePlaybackInput) => Promise<void>;
  startSelectionPlayback: (input: SelectionPlaybackInput) => Promise<void>;
  unlockAudio: () => void;
  togglePlayPause: () => void;
  pausePlayback: () => void;
  resumePlayback: () => void;
  stopPlayback: () => void;
  nextSegment: () => void;
  prevSegment: () => void;
  nextPageAudio: () => void;
  prevPageAudio: () => void;
  nextChapter: () => void;
  prevChapter: () => void;
  seekDeltaSeconds: (delta: number) => void;
  jumpToSegmentIndex: (index: number) => void;
  jumpToChapter: (chapterIndex: number) => void;
  jumpToBlockSentence: (blockId: string, sentenceIndex?: number) => Promise<void>;
  updatePreferences: (patch: Partial<UserVoicePreferences>) => void;
  setVoiceAndApply: (voiceId: GeminiPrebuiltVoiceId) => void;
  setBrowserVoiceAndApply: (voiceURI: string) => void;
  setAudioEngineAndApply: (engine: AudioEnginePreference) => void;
  setStyleAndApply: (style: NarrationStyleId) => void;
  setSpeed: (speed: number) => void;
  setVolume: (vol: number) => void;
  setSleepTimer: (minutes: number) => void;
  setMinimized: (min: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
  retryCurrentSegment: () => void;
  updateSessionTranslationMap: (
    bookId: string,
    language: string,
    translatedMap: Record<string, string>,
  ) => void;
}

const AudiobookContext = createContext<AudiobookContextValue | null>(null);

export function AudiobookProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AudiobookSession | null>(null);
  const [status, setStatus] = useState<AudiobookStatus>("idle");
  const [activeEngine, setActiveEngine] = useState<"ai" | "browser">("ai");
  const [availableBrowserVoices, setAvailableBrowserVoices] = useState<BrowserVoiceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<UserVoicePreferences>(loadVoicePreferencesSync);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const webSpeechRef = useRef<WebSpeechController | null>(null);
  const currentObjectUrlRef = useRef<string | null>(null);
  const inflightFetchRef = useRef<Map<string, Promise<Blob>>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<AudiobookSession | null>(null);
  const prefsRef = useRef<UserVoicePreferences>(preferences);
  const statusRef = useRef<AudiobookStatus>(status);
  const activeEngineRef = useRef<"ai" | "browser">(activeEngine);
  const sleepTimerModeRef = useRef<number>(preferences.sleepTimerMinutes);
  const lastSavedListenAtRef = useRef<number>(0);
  const preloadCooldownUntilRef = useRef<number>(0);
  const aiTtsCooldownUntilRef = useRef<number>(0);
  const volumeRef = useRef<number>(volume);

  sessionRef.current = session;
  prefsRef.current = preferences;
  statusRef.current = status;
  activeEngineRef.current = activeEngine;
  volumeRef.current = volume;

  const ensureWebSpeech = useCallback(() => {
    if (!webSpeechRef.current) {
      webSpeechRef.current = new WebSpeechController();
    }
    return webSpeechRef.current;
  }, []);

  // Sync device voices list whenever browser populates speechSynthesis.getVoices()
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const syncVoices = () => {
      const { all } = listBrowserVoicesForLanguage(sessionRef.current?.language || prefsRef.current.preferredTtsLanguage || "en");
      setAvailableBrowserVoices(all);
    };
    syncVoices();
    const synth = window.speechSynthesis;
    synth.addEventListener?.("voiceschanged", syncVoices);
    return () => {
      synth.removeEventListener?.("voiceschanged", syncVoices);
    };
  }, []);

  const ensureAudioElement = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = "auto";
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  const unlockAudio = useCallback(() => {
    const audio = ensureAudioElement();
    if (!audio) return;
    if (audio.paused && (!audio.src || audio.src.startsWith("data:"))) {
      try {
        audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
        const p = audio.play();
        if (p && typeof p.then === "function") {
          void p
            .then(() => {
              if (audio.src.startsWith("data:")) {
                audio.pause();
                audio.currentTime = 0;
              }
            })
            .catch(() => {});
        }
      } catch {
        /* ignore browser gesture edge errors */
      }
    }
  }, [ensureAudioElement]);

  const revokeCurrentUrl = useCallback(() => {
    if (currentObjectUrlRef.current) {
      URL.revokeObjectURL(currentObjectUrlRef.current);
      currentObjectUrlRef.current = null;
    }
  }, []);

  const persistProgressNow = useCallback((sess: AudiobookSession | null, posSec = 0) => {
    if (!sess || sess.scope === "selection") return;
    const seg = sess.segments[sess.currentSegmentIndex];
    const chap = sess.chapters[sess.currentChapterIndex];
    if (!seg || !chap) return;
    const record: ListeningProgressRecord = {
      bookId: sess.bookId,
      bookTitle: sess.bookTitle,
      coverUrl: sess.coverUrl,
      language: sess.language,
      chapterId: chap.id,
      chapterTitle: chap.title,
      chapterIndex: sess.currentChapterIndex,
      blockId: seg.blockId,
      blockIndex: seg.blockIndex,
      sentenceIndex: seg.sentenceIndex,
      playbackPosition: Number.isFinite(posSec) ? posSec : 0,
      playbackSpeed: prefsRef.current.preferredSpeed || 1,
      updatedAt: Date.now(),
    };
    void saveListeningProgress(record);
  }, []);

  const fetchAudioBlob = useCallback(
    async (seg: AudioSegment, prefs: UserVoicePreferences, signal?: AbortSignal): Promise<Blob> => {
      const cached = await loadCachedAudioSegment(seg.contentHash);
      if (cached) return cached;

      const existing = inflightFetchRef.current.get(seg.contentHash);
      if (existing) return existing;

      const promise = generateSpeechWav({
        text: seg.text,
        language: seg.language,
        voiceId: prefs.preferredVoice,
        secondaryVoiceId: prefs.preferredSecondaryVoice,
        style: prefs.preferredStyle,
        dialogueMode: prefs.dialogueMode && seg.hasDialogue,
        signal,
      })
        .then(async (blob) => {
          await saveCachedAudioSegment(seg.contentHash, blob);
          return blob;
        })
        .catch((err) => {
          if (err instanceof AiServiceError && (err.status === 429 || err.code === "RATE_LIMITED")) {
            preloadCooldownUntilRef.current = Date.now() + 25_000;
            aiTtsCooldownUntilRef.current = Date.now() + 45_000;
          } else if (
            err instanceof AiServiceError &&
            (err.code === "AI_NOT_CONFIGURED" || err.code === "API_KEY_INVALID" || err.code === "MODEL_NOT_FOUND" || err.status === 401 || err.status === 403 || err.status >= 500)
          ) {
            aiTtsCooldownUntilRef.current = Date.now() + 90_000;
          }
          throw err;
        })
        .finally(() => {
          inflightFetchRef.current.delete(seg.contentHash);
        });

      inflightFetchRef.current.set(seg.contentHash, promise);
      return promise;
    },
    [],
  );

  const preloadNextSegments = useCallback(
    (sess: AudiobookSession, fromIndex: number, prefs: UserVoicePreferences) => {
      if (prefs.preferredAudioEngine === "browser" || activeEngineRef.current === "browser") return;
      if (Date.now() < preloadCooldownUntilRef.current || Date.now() < aiTtsCooldownUntilRef.current) return;
      const nextSeg = sess.segments[fromIndex + 1];
      if (!nextSeg) return;
      window.setTimeout(() => {
        if (Date.now() < preloadCooldownUntilRef.current || Date.now() < aiTtsCooldownUntilRef.current) return;
        if (statusRef.current !== "playing" && statusRef.current !== "loading") return;
        void loadCachedAudioSegment(nextSeg.contentHash).then((hit) => {
          if (!hit) {
            void fetchAudioBlob(nextSeg, prefs).catch(() => {
              /* handled silently */
            });
          }
        });
      }, 900);
    },
    [fetchAudioBlob],
  );

  const handleSegmentEndedRef = useRef<() => void>(() => {});

  const playSegmentWithWebSpeech = useCallback(
    async (updatedSession: AudiobookSession, seg: AudioSegment, controller: AbortController) => {
      const ws = ensureWebSpeech();
      if (!isWebSpeechSupported()) {
        throw new Error("Audio narration is unavailable: neither Studio TTS nor device speech synthesis is supported in this browser.");
      }

      const prefs = prefsRef.current;
      activeEngineRef.current = "browser";
      setActiveEngine("browser");
      setStatus("playing");
      setError(null);
      setErrorCode(null);

      persistProgressNow(updatedSession, 0);

      await ws.speak({
        text: seg.text,
        language: seg.language,
        rate: prefs.preferredSpeed || 1,
        volume: volumeRef.current,
        preferredVoiceUri: prefs.preferredBrowserVoiceUri,
        onStart: (estTotal) => {
          if (controller.signal.aborted) return;
          setDuration(estTotal);
          setCurrentTime(0);
          setStatus("playing");
        },
        onProgress: (elapsed, total) => {
          if (controller.signal.aborted) return;
          setCurrentTime(elapsed);
          setDuration(total);
        },
        onEnded: () => {
          if (controller.signal.aborted) return;
          handleSegmentEndedRef.current();
        },
        onError: (msg) => {
          if (controller.signal.aborted) return;
          setError(msg);
          setErrorCode("BROWSER_TTS_ERROR");
          setStatus("error");
        },
      });
    },
    [ensureWebSpeech, persistProgressNow],
  );

  const playSegmentAt = useCallback(
    async (targetSession: AudiobookSession, segIndex: number, startSec = 0) => {
      const audio = ensureAudioElement();
      const ws = ensureWebSpeech();

      const seg = targetSession.segments[segIndex];
      if (!seg) return;

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Stop any active audio across both engines cleanly
      ws.cancel();
      if (audio) {
        audio.pause();
      }

      const updatedSession: AudiobookSession = {
        ...targetSession,
        currentPage: seg.page || targetSession.currentPage,
        currentSegmentIndex: segIndex,
      };
      sessionRef.current = updatedSession;
      setSession(updatedSession);
      setStatus("loading");
      setError(null);
      setErrorCode(null);
      setCurrentTime(0);
      setDuration(0);

      const prefs = prefsRef.current;
      const enginePref = prefs.preferredAudioEngine || "auto";
      const shouldUseBrowserDirectly =
        enginePref === "browser" ||
        (enginePref === "auto" && Date.now() < aiTtsCooldownUntilRef.current);

      if (shouldUseBrowserDirectly) {
        try {
          await playSegmentWithWebSpeech(updatedSession, seg, controller);
        } catch (err) {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : "Device voice playback failed.");
          setErrorCode("TTS_FAILED");
          setStatus("error");
        }
        return;
      }

      try {
        if (!audio) {
          throw new Error("HTMLAudioElement unavailable.");
        }
        const blob = await fetchAudioBlob(seg, prefs, controller.signal);
        if (controller.signal.aborted) return;

        revokeCurrentUrl();
        const url = URL.createObjectURL(blob);
        currentObjectUrlRef.current = url;

        audio.src = url;
        audio.volume = volumeRef.current;
        audio.playbackRate = prefs.preferredSpeed || 1;

        if (audio.readyState < 2) {
          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const onAbort = () => finish(() => reject(new DOMException("Aborted", "AbortError")));
            const timer = window.setTimeout(
              () => finish(() => reject(new Error("Audio loading timed out."))),
              12000,
            );
            const cleanup = () => {
              window.clearTimeout(timer);
              audio.removeEventListener("canplay", onReady);
              audio.removeEventListener("loadeddata", onReady);
              audio.removeEventListener("error", onErr);
              controller.signal.removeEventListener("abort", onAbort);
            };
            const finish = (cb: () => void) => {
              if (settled) return;
              settled = true;
              cleanup();
              cb();
            };
            const onReady = () => finish(resolve);
            const onErr = () =>
              finish(() => reject(new Error("Audio element failed to decode speech segment.")));

            controller.signal.addEventListener("abort", onAbort, { once: true });
            audio.addEventListener("canplay", onReady, { once: true });
            audio.addEventListener("loadeddata", onReady, { once: true });
            audio.addEventListener("error", onErr, { once: true });
            audio.load();
          });
        }

        if (startSec > 0 && Number.isFinite(audio.duration) && startSec < audio.duration) {
          audio.currentTime = startSec;
        }

        if (controller.signal.aborted) return;
        activeEngineRef.current = "ai";
        setActiveEngine("ai");

        try {
          await audio.play();
          setStatus("playing");
        } catch (playErr) {
          if ((playErr as { name?: string })?.name === "NotAllowedError") {
            setStatus("paused");
            setError(null);
            setErrorCode(null);
            return;
          }
          throw playErr;
        }
        persistProgressNow(updatedSession, audio.currentTime);
        preloadNextSegments(updatedSession, segIndex, prefs);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError" || controller.signal.aborted) return;

        // Automatic Free Device Voice fallback whenever enginePref === "auto"
        if (enginePref === "auto" && isWebSpeechSupported()) {
          try {
            await playSegmentWithWebSpeech(updatedSession, seg, controller);
            return;
          } catch (fallbackErr) {
            if (controller.signal.aborted) return;
            setError(
              fallbackErr instanceof Error
                ? fallbackErr.message
                : "Could not play audio with AI or device voice.",
            );
            setErrorCode("TTS_FAILED");
            setStatus("error");
            return;
          }
        }

        const message =
          err instanceof Error ? err.message : "Failed to generate narration audio for this segment.";
        const code = err instanceof AiServiceError ? err.code : "TTS_FAILED";
        setError(message);
        setErrorCode(code);
        setStatus("error");
      }
    },
    [
      ensureAudioElement,
      ensureWebSpeech,
      fetchAudioBlob,
      persistProgressNow,
      playSegmentWithWebSpeech,
      preloadNextSegments,
      revokeCurrentUrl,
    ],
  );

  const buildSegmentsForChapter = useCallback(
    (
      book: ReflowBook,
      chapters: Chapter[],
      chapterIndex: number,
      bookId: string,
      language: string,
      prefs: UserVoicePreferences,
      translatedMap?: Record<string, string>,
    ): { chapterIndex: number; segments: AudioSegment[] } => {
      for (let idx = Math.max(0, chapterIndex); idx < chapters.length; idx++) {
        const range = getChapterBlockRange(book, idx);
        if (!range) continue;
        const segments = buildChapterAudioSegments({
          bookId,
          chapter: range.chapter,
          blocks: book.blocks,
          startIndex: range.startIndex,
          endIndex: range.endIndex,
          language,
          voiceId: prefs.preferredVoice,
          style: prefs.preferredStyle,
          translatedMap,
          mode: "paragraph",
        });
        if (segments.length > 0) {
          return { chapterIndex: idx, segments };
        }
      }
      return { chapterIndex: Math.max(0, chapterIndex), segments: [] };
    },
    [],
  );

  const startBookPlayback = useCallback(
    async (input: AudiobookStartInput) => {
      const chapters = resolveBookChapters(input.reflowBook);
      if (chapters.length === 0) {
        setError("No readable text blocks found in this book for audio narration.");
        setErrorCode("NO_TEXT_CONTENT");
        setStatus("error");
        return;
      }

      const prefs = prefsRef.current;
      const resolved = resolveChapterAndBlockIndex(
        input.reflowBook,
        chapters,
        input.chapterId,
        input.startBlockId,
        input.chapterIndex ?? 0,
      );

      const built = buildSegmentsForChapter(
        input.reflowBook,
        chapters,
        resolved.chapterIndex,
        input.bookId,
        input.language,
        prefs,
        input.translatedMap,
      );

      if (built.segments.length === 0) {
        setError("This section contains no narratable paragraphs (e.g., cover or scanned image page).");
        setErrorCode("NO_NARRATABLE_TEXT");
        setStatus("error");
        return;
      }

      let startSegIdx = 0;
      if (input.startBlockId) {
        const matchIdx = built.segments.findIndex(
          (s) =>
            s.blockId === input.startBlockId &&
            (input.startSentenceIndex === undefined || s.sentenceIndex === input.startSentenceIndex),
        );
        if (matchIdx >= 0) {
          startSegIdx = matchIdx;
        } else {
          const fallbackBlockIdx = built.segments.findIndex((s) => s.blockId === input.startBlockId);
          if (fallbackBlockIdx >= 0) startSegIdx = fallbackBlockIdx;
        }
      }

      const firstSeg = built.segments[startSegIdx] ?? built.segments[0];
      const newSession: AudiobookSession = {
        bookId: input.bookId,
        bookTitle: input.bookTitle,
        author: input.author,
        coverUrl: input.coverUrl,
        reflowBook: input.reflowBook,
        chapters,
        currentChapterIndex: built.chapterIndex,
        currentPage: input.page ?? firstSeg?.page ?? 1,
        scope: input.scope ?? "book",
        language: input.language,
        translatedMap: input.translatedMap,
        segments: built.segments,
        currentSegmentIndex: startSegIdx,
      };

      setDrawerOpen(true);
      setIsMinimized(false);
      await playSegmentAt(newSession, startSegIdx, input.startPositionSec ?? 0);
    },
    [buildSegmentsForChapter, playSegmentAt],
  );

  const startPagePlayback = useCallback(
    async (input: PagePlaybackInput) => {
      const chapters = resolveBookChapters(input.reflowBook);
      const prefs = prefsRef.current;
      const segments = buildPageAudioSegments({
        bookId: input.bookId,
        book: input.reflowBook,
        page: input.page,
        language: input.language,
        voiceId: prefs.preferredVoice,
        style: prefs.preferredStyle,
        translatedMap: input.translatedMap,
        fallbackStartBlockIndex: input.fallbackStartBlockIndex,
      });

      if (segments.length === 0) {
        setError(`No narratable text found on page ${input.page}.`);
        setErrorCode("NO_NARRATABLE_TEXT");
        setStatus("error");
        return;
      }

      const chapIdx = Math.max(
        0,
        chapters.findIndex((c) => c.id === segments[0].chapterId),
      );

      const newSession: AudiobookSession = {
        bookId: input.bookId,
        bookTitle: input.bookTitle,
        author: input.author,
        coverUrl: input.coverUrl,
        reflowBook: input.reflowBook,
        chapters: chapters.length
          ? chapters
          : [{ id: `page_${input.page}`, title: `Page ${input.page}`, blockIndex: 0, page: input.page, level: 0 }],
        currentChapterIndex: chapIdx,
        currentPage: input.page,
        scope: "page",
        language: input.language,
        translatedMap: input.translatedMap,
        segments,
        currentSegmentIndex: 0,
      };

      setDrawerOpen(true);
      setIsMinimized(false);
      await playSegmentAt(newSession, 0, 0);
    },
    [playSegmentAt],
  );

  const startSelectionPlayback = useCallback(
    async (input: SelectionPlaybackInput) => {
      const chapters = resolveBookChapters(input.reflowBook);
      const prefs = prefsRef.current;
      const segments = buildSelectionAudioSegments({
        bookId: input.bookId,
        text: input.text,
        language: input.language,
        voiceId: prefs.preferredVoice,
        style: prefs.preferredStyle,
        blockId: input.blockId,
        blockIndex: input.blockIndex,
        chapterId: input.chapterId,
        chapterTitle: input.chapterTitle || "Selected Text",
        page: input.page,
      });

      if (segments.length === 0) {
        setError("Selected text is empty.");
        setErrorCode("NO_TEXT_CONTENT");
        setStatus("error");
        return;
      }

      const resolved = resolveChapterAndBlockIndex(
        input.reflowBook,
        chapters,
        input.chapterId,
        input.blockId,
        0,
      );

      const newSession: AudiobookSession = {
        bookId: input.bookId,
        bookTitle: input.bookTitle,
        author: input.author,
        coverUrl: input.coverUrl,
        reflowBook: input.reflowBook,
        chapters: chapters.length
          ? chapters
          : [{ id: "selection", title: "Selected Text", blockIndex: 0, page: input.page ?? 1, level: 0 }],
        currentChapterIndex: resolved.chapterIndex,
        currentPage: input.page ?? 1,
        scope: "selection",
        language: input.language,
        segments,
        currentSegmentIndex: 0,
      };

      setDrawerOpen(true);
      setIsMinimized(false);
      await playSegmentAt(newSession, 0, 0);
    },
    [playSegmentAt],
  );

  const jumpToChapter = useCallback(
    (chapterIndex: number) => {
      const sess = sessionRef.current;
      if (!sess) return;
      const bounded = Math.max(0, Math.min(chapterIndex, sess.chapters.length - 1));
      const built = buildSegmentsForChapter(
        sess.reflowBook,
        sess.chapters,
        bounded,
        sess.bookId,
        sess.language,
        prefsRef.current,
        sess.translatedMap,
      );
      if (built.segments.length === 0) {
        setError("Selected chapter has no readable text.");
        setStatus("error");
        return;
      }
      const nextSession: AudiobookSession = {
        ...sess,
        scope: sess.scope === "selection" || sess.scope === "page" ? "chapter" : sess.scope,
        currentChapterIndex: built.chapterIndex,
        currentPage: built.segments[0]?.page ?? sess.currentPage,
        segments: built.segments,
        currentSegmentIndex: 0,
      };
      void playSegmentAt(nextSession, 0, 0);
    },
    [buildSegmentsForChapter, playSegmentAt],
  );

  const handleSegmentEnded = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess) return;
    const nextIdx = sess.currentSegmentIndex + 1;
    if (nextIdx < sess.segments.length) {
      void playSegmentAt(sess, nextIdx, 0);
      return;
    }

    // Selected-text or Page-only scope stops cleanly once its segments finish
    if (sess.scope === "selection" || sess.scope === "page" || sess.scope === "chapter") {
      setStatus("paused");
      persistProgressNow(sess, 0);
      return;
    }

    // Sleep timer: end of chapter
    if (sleepTimerModeRef.current === -1) {
      sleepTimerModeRef.current = 0;
      setSleepRemainingSec(null);
      setStatus("paused");
      persistProgressNow(sess, 0);
      return;
    }

    if (sess.currentChapterIndex + 1 < sess.chapters.length) {
      jumpToChapter(sess.currentChapterIndex + 1);
    } else {
      setStatus("paused");
      persistProgressNow(sess, 0);
    }
  }, [jumpToChapter, persistProgressNow, playSegmentAt]);

  handleSegmentEndedRef.current = handleSegmentEnded;

  // Attach HTMLAudioElement listeners once
  useEffect(() => {
    const audio = ensureAudioElement();
    if (!audio) return;

    const onTimeUpdate = () => {
      if (activeEngineRef.current !== "ai") return;
      setCurrentTime(audio.currentTime || 0);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      const now = Date.now();
      if (now - lastSavedListenAtRef.current > 3500) {
        lastSavedListenAtRef.current = now;
        persistProgressNow(sessionRef.current, audio.currentTime || 0);
      }
    };
    const onLoadedMeta = () => {
      if (activeEngineRef.current !== "ai") return;
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onEnded = () => {
      if (activeEngineRef.current !== "ai") return;
      handleSegmentEnded();
    };
    const onPlay = () => {
      if (activeEngineRef.current !== "ai") return;
      if (statusRef.current !== "loading") setStatus("playing");
    };
    const onPause = () => {
      if (activeEngineRef.current !== "ai") return;
      if (statusRef.current === "playing") {
        setStatus("paused");
        persistProgressNow(sessionRef.current, audio.currentTime || 0);
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMeta);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMeta);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [ensureAudioElement, handleSegmentEnded, persistProgressNow]);

  // Sleep timer countdown
  useEffect(() => {
    if (sleepRemainingSec === null || sleepRemainingSec <= 0) return;
    const id = window.setInterval(() => {
      setSleepRemainingSec((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          audioRef.current?.pause();
          webSpeechRef.current?.pause();
          setStatus("paused");
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [sleepRemainingSec]);

  const pausePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (activeEngineRef.current === "browser") {
      webSpeechRef.current?.pause();
      persistProgressNow(sessionRef.current, 0);
    } else if (audio) {
      audio.pause();
      persistProgressNow(sessionRef.current, audio.currentTime || 0);
    }
    setStatus("paused");
  }, [persistProgressNow]);

  const resumePlayback = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess) return;
    if (activeEngineRef.current === "browser") {
      if (typeof window !== "undefined" && window.speechSynthesis?.paused) {
        webSpeechRef.current?.resume();
        setStatus("playing");
      } else {
        void playSegmentAt(sess, sess.currentSegmentIndex, 0);
      }
      return;
    }

    const audio = audioRef.current;
    if (audio && audio.src && !audio.ended) {
      audio.playbackRate = prefsRef.current.preferredSpeed || 1;
      void audio
        .play()
        .then(() => setStatus("playing"))
        .catch(() => void playSegmentAt(sess, sess.currentSegmentIndex, 0));
    } else {
      void playSegmentAt(sess, sess.currentSegmentIndex, 0);
    }
  }, [playSegmentAt]);

  const togglePlayPause = useCallback(() => {
    if (statusRef.current === "playing") pausePlayback();
    else if (statusRef.current === "paused" || statusRef.current === "error") resumePlayback();
  }, [pausePlayback, resumePlayback]);

  const stopPlayback = useCallback(() => {
    abortControllerRef.current?.abort();
    webSpeechRef.current?.cancel();
    const audio = audioRef.current;
    if (audio) {
      persistProgressNow(sessionRef.current, audio.currentTime || 0);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    revokeCurrentUrl();
    setSession(null);
    sessionRef.current = null;
    setStatus("idle");
    setError(null);
    setErrorCode(null);
    setCurrentTime(0);
    setDuration(0);
    setIsMinimized(false);
    setDrawerOpen(false);
  }, [persistProgressNow, revokeCurrentUrl]);

  const nextSegment = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess) return;
    if (sess.currentSegmentIndex + 1 < sess.segments.length) {
      void playSegmentAt(sess, sess.currentSegmentIndex + 1, 0);
    } else if (sess.currentChapterIndex + 1 < sess.chapters.length) {
      jumpToChapter(sess.currentChapterIndex + 1);
    }
  }, [jumpToChapter, playSegmentAt]);

  const prevSegment = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess) return;
    if (sess.currentSegmentIndex > 0) {
      void playSegmentAt(sess, sess.currentSegmentIndex - 1, 0);
    } else if (sess.currentChapterIndex > 0) {
      jumpToChapter(sess.currentChapterIndex - 1);
    }
  }, [jumpToChapter, playSegmentAt]);

  const movePageAudio = useCallback(
    (delta: 1 | -1) => {
      const sess = sessionRef.current;
      if (!sess) return;
      const totalPages = Math.max(1, sess.reflowBook.meta.totalPages || 1);
      const currSeg = sess.segments[sess.currentSegmentIndex];
      const basePage = currSeg?.page || sess.currentPage || 1;
      const targetPage = Math.max(1, Math.min(totalPages, basePage + delta));
      if (targetPage === basePage) return;

      if (sess.scope === "page") {
        void startPagePlayback({
          bookId: sess.bookId,
          bookTitle: sess.bookTitle,
          author: sess.author,
          coverUrl: sess.coverUrl,
          reflowBook: sess.reflowBook,
          page: targetPage,
          language: sess.language,
          translatedMap: sess.translatedMap,
        });
        return;
      }

      // In chapter/book scope, jump directly to first block on targetPage
      const matchBlock = sess.reflowBook.blocks.find(
        (b) => (b.type === "paragraph" || b.type === "heading") && b.page >= targetPage && b.text.trim(),
      );
      if (!matchBlock) return;
      const inCurrent = sess.segments.findIndex((s) => s.blockId === matchBlock.id);
      if (inCurrent >= 0) {
        void playSegmentAt(sess, inCurrent, 0);
      } else {
        const resolved = resolveChapterAndBlockIndex(sess.reflowBook, sess.chapters, undefined, matchBlock.id);
        const built = buildSegmentsForChapter(
          sess.reflowBook,
          sess.chapters,
          resolved.chapterIndex,
          sess.bookId,
          sess.language,
          prefsRef.current,
          sess.translatedMap,
        );
        if (!built.segments.length) return;
        const idx = Math.max(0, built.segments.findIndex((s) => s.blockId === matchBlock.id));
        const nextSess: AudiobookSession = {
          ...sess,
          currentChapterIndex: built.chapterIndex,
          currentPage: targetPage,
          segments: built.segments,
          currentSegmentIndex: idx,
        };
        void playSegmentAt(nextSess, idx, 0);
      }
    },
    [buildSegmentsForChapter, playSegmentAt, startPagePlayback],
  );

  const nextPageAudio = useCallback(() => movePageAudio(1), [movePageAudio]);
  const prevPageAudio = useCallback(() => movePageAudio(-1), [movePageAudio]);

  const nextChapter = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess) return;
    if (sess.currentChapterIndex + 1 < sess.chapters.length) {
      jumpToChapter(sess.currentChapterIndex + 1);
    }
  }, [jumpToChapter]);

  const prevChapter = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess) return;
    if (sess.currentChapterIndex > 0) {
      jumpToChapter(sess.currentChapterIndex - 1);
    }
  }, [jumpToChapter]);

  const seekDeltaSeconds = useCallback(
    (delta: number) => {
      const sess = sessionRef.current;
      if (!sess) return;
      if (activeEngineRef.current === "browser") {
        if (delta < 0) prevSegment();
        else nextSegment();
        return;
      }
      const audio = audioRef.current;
      if (!audio) return;
      const target = (audio.currentTime || 0) + delta;
      if (target < 0) {
        if (sess.currentSegmentIndex > 0) {
          void playSegmentAt(sess, sess.currentSegmentIndex - 1, 0);
        } else {
          audio.currentTime = 0;
        }
        return;
      }
      if (Number.isFinite(audio.duration) && target >= audio.duration) {
        nextSegment();
        return;
      }
      audio.currentTime = target;
      setCurrentTime(target);
    },
    [nextSegment, playSegmentAt, prevSegment],
  );

  const jumpToSegmentIndex = useCallback(
    (index: number) => {
      const sess = sessionRef.current;
      if (!sess) return;
      const clamped = Math.max(0, Math.min(index, sess.segments.length - 1));
      void playSegmentAt(sess, clamped, 0);
    },
    [playSegmentAt],
  );

  const jumpToBlockSentence = useCallback(
    async (blockId: string, sentenceIndex = 0) => {
      const sess = sessionRef.current;
      if (!sess) return;
      let existingIdx = sess.segments.findIndex(
        (s) => s.blockId === blockId && s.sentenceIndex === sentenceIndex,
      );
      if (existingIdx < 0) {
        existingIdx = sess.segments.findIndex((s) => s.blockId === blockId);
      }
      if (existingIdx >= 0) {
        await playSegmentAt(sess, existingIdx, 0);
        return;
      }

      const resolved = resolveChapterAndBlockIndex(sess.reflowBook, sess.chapters, undefined, blockId);
      const built = buildSegmentsForChapter(
        sess.reflowBook,
        sess.chapters,
        resolved.chapterIndex,
        sess.bookId,
        sess.language,
        prefsRef.current,
        sess.translatedMap,
      );
      if (!built.segments.length) return;
      let segIdx = built.segments.findIndex(
        (s) => s.blockId === blockId && s.sentenceIndex === sentenceIndex,
      );
      if (segIdx < 0) {
        segIdx = built.segments.findIndex((s) => s.blockId === blockId);
      }
      segIdx = Math.max(0, segIdx);
      const nextSess: AudiobookSession = {
        ...sess,
        scope: "book",
        currentChapterIndex: built.chapterIndex,
        currentPage: built.segments[segIdx]?.page ?? sess.currentPage,
        segments: built.segments,
        currentSegmentIndex: segIdx,
      };
      await playSegmentAt(nextSess, segIdx, 0);
    },
    [buildSegmentsForChapter, playSegmentAt],
  );

  const updatePreferences = useCallback((patch: Partial<UserVoicePreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...patch };
      prefsRef.current = next;
      saveVoicePreferencesSync(next);
      return next;
    });
  }, []);

  const rebuildSegmentsWithPrefs = useCallback(
    (nextPrefs: UserVoicePreferences) => {
      const sess = sessionRef.current;
      if (!sess) return;
      if (sess.scope === "selection") {
        void playSegmentAt(sess, sess.currentSegmentIndex, 0);
        return;
      }
      if (sess.scope === "page") {
        const segs = buildPageAudioSegments({
          bookId: sess.bookId,
          book: sess.reflowBook,
          page: sess.currentPage,
          language: sess.language,
          voiceId: nextPrefs.preferredVoice,
          style: nextPrefs.preferredStyle,
          translatedMap: sess.translatedMap,
        });
        if (!segs.length) return;
        const idx = Math.min(sess.currentSegmentIndex, segs.length - 1);
        void playSegmentAt({ ...sess, segments: segs, currentSegmentIndex: idx }, idx, 0);
        return;
      }

      const currentSeg = sess.segments[sess.currentSegmentIndex];
      const built = buildSegmentsForChapter(
        sess.reflowBook,
        sess.chapters,
        sess.currentChapterIndex,
        sess.bookId,
        sess.language,
        nextPrefs,
        sess.translatedMap,
      );
      if (!built.segments.length) return;
      const newSegIdx = currentSeg
        ? Math.max(
            0,
            built.segments.findIndex(
              (s) => s.blockId === currentSeg.blockId && s.sentenceIndex === currentSeg.sentenceIndex,
            ),
          )
        : 0;
      const updatedSess: AudiobookSession = {
        ...sess,
        segments: built.segments,
        currentSegmentIndex: newSegIdx,
      };
      void playSegmentAt(updatedSess, newSegIdx, 0);
    },
    [buildSegmentsForChapter, playSegmentAt],
  );

  const setVoiceAndApply = useCallback(
    (voiceId: GeminiPrebuiltVoiceId) => {
      aiTtsCooldownUntilRef.current = 0;
      const next = { ...prefsRef.current, preferredVoice: voiceId };
      prefsRef.current = next;
      setPreferences(next);
      saveVoicePreferencesSync(next);
      rebuildSegmentsWithPrefs(next);
    },
    [rebuildSegmentsWithPrefs],
  );

  const setBrowserVoiceAndApply = useCallback(
    (voiceURI: string) => {
      const next: UserVoicePreferences = {
        ...prefsRef.current,
        preferredBrowserVoiceUri: voiceURI,
      };
      prefsRef.current = next;
      setPreferences(next);
      saveVoicePreferencesSync(next);
      const sess = sessionRef.current;
      if (sess && (activeEngineRef.current === "browser" || next.preferredAudioEngine === "browser")) {
        void playSegmentAt(sess, sess.currentSegmentIndex, 0);
      }
    },
    [playSegmentAt],
  );

  const setAudioEngineAndApply = useCallback(
    (engine: AudioEnginePreference) => {
      if (engine !== "browser") {
        aiTtsCooldownUntilRef.current = 0;
      }
      const next: UserVoicePreferences = {
        ...prefsRef.current,
        preferredAudioEngine: engine,
      };
      prefsRef.current = next;
      setPreferences(next);
      saveVoicePreferencesSync(next);
      const sess = sessionRef.current;
      if (sess && statusRef.current !== "idle") {
        void playSegmentAt(sess, sess.currentSegmentIndex, 0);
      }
    },
    [playSegmentAt],
  );

  const setStyleAndApply = useCallback(
    (style: NarrationStyleId) => {
      const next = { ...prefsRef.current, preferredStyle: style };
      prefsRef.current = next;
      setPreferences(next);
      saveVoicePreferencesSync(next);
      rebuildSegmentsWithPrefs(next);
    },
    [rebuildSegmentsWithPrefs],
  );

  const setSpeed = useCallback(
    (speed: number) => {
      const clamped = Math.min(2.0, Math.max(0.5, Number(speed) || 1));
      updatePreferences({ preferredSpeed: clamped });
      if (audioRef.current) {
        audioRef.current.playbackRate = clamped;
      }
      webSpeechRef.current?.setRate(clamped);
      const sess = sessionRef.current;
      if (sess && activeEngineRef.current === "browser" && statusRef.current === "playing") {
        void playSegmentAt(sess, sess.currentSegmentIndex, 0);
      }
    },
    [playSegmentAt, updatePreferences],
  );

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.min(1, Math.max(0, vol));
    setVolumeState(clamped);
    volumeRef.current = clamped;
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
    webSpeechRef.current?.setVolume(clamped);
  }, []);

  const setSleepTimer = useCallback(
    (minutes: number) => {
      sleepTimerModeRef.current = minutes;
      updatePreferences({ sleepTimerMinutes: minutes });
      if (minutes > 0) {
        setSleepRemainingSec(minutes * 60);
      } else {
        setSleepRemainingSec(null);
      }
    },
    [updatePreferences],
  );

  const retryCurrentSegment = useCallback(() => {
    aiTtsCooldownUntilRef.current = 0;
    const sess = sessionRef.current;
    if (!sess) return;
    void playSegmentAt(sess, sess.currentSegmentIndex, 0);
  }, [playSegmentAt]);

  const updateSessionTranslationMap = useCallback(
    (bookId: string, language: string, translatedMap: Record<string, string>) => {
      const sess = sessionRef.current;
      if (!sess || sess.bookId !== bookId) return;
      if (sess.language !== language) return;
      if (sess.scope === "selection") return;
      const currentSeg = sess.segments[sess.currentSegmentIndex];
      const built = buildSegmentsForChapter(
        sess.reflowBook,
        sess.chapters,
        sess.currentChapterIndex,
        sess.bookId,
        language,
        prefsRef.current,
        translatedMap,
      );
      if (!built.segments.length) return;
      const newSegIdx = currentSeg
        ? Math.max(
            0,
            built.segments.findIndex(
              (s) => s.blockId === currentSeg.blockId && s.sentenceIndex === currentSeg.sentenceIndex,
            ),
          )
        : 0;
      const nextSess: AudiobookSession = {
        ...sess,
        translatedMap,
        segments: built.segments,
        currentSegmentIndex: newSegIdx,
      };
      sessionRef.current = nextSess;
      setSession(nextSess);
    },
    [buildSegmentsForChapter],
  );

  // Media Session API for lock-screen & headphone controls
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (!session) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const chapter = session.chapters[session.currentChapterIndex];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: chapter?.title ? `${session.bookTitle} · ${chapter.title}` : session.bookTitle,
        artist: session.author || "SHA-VERSE Audiobook",
        album: session.language.toUpperCase(),
        artwork: session.coverUrl
          ? [{ src: session.coverUrl, sizes: "512x512", type: "image/png" }]
          : undefined,
      });
      navigator.mediaSession.setActionHandler("play", () => resumePlayback());
      navigator.mediaSession.setActionHandler("pause", () => pausePlayback());
      navigator.mediaSession.setActionHandler("previoustrack", () => prevSegment());
      navigator.mediaSession.setActionHandler("nexttrack", () => nextSegment());
      navigator.mediaSession.setActionHandler("seekbackward", () => seekDeltaSeconds(-10));
      navigator.mediaSession.setActionHandler("seekforward", () => seekDeltaSeconds(10));
    } catch {
      /* ignore MediaSession unsupported action errors */
    }
  }, [session, resumePlayback, pausePlayback, prevSegment, nextSegment, seekDeltaSeconds]);

  const activeSegment = useMemo(
    () => (session ? session.segments[session.currentSegmentIndex] ?? null : null),
    [session],
  );

  const value = useMemo<AudiobookContextValue>(
    () => ({
      session,
      status,
      activeEngine,
      availableBrowserVoices,
      error,
      errorCode,
      preferences,
      isMinimized,
      isDrawerOpen,
      volume,
      currentTime,
      duration,
      sleepRemainingSec,
      activeSegment,
      startBookPlayback,
      startPagePlayback,
      startSelectionPlayback,
      unlockAudio,
      togglePlayPause,
      pausePlayback,
      resumePlayback,
      stopPlayback,
      nextSegment,
      prevSegment,
      nextPageAudio,
      prevPageAudio,
      nextChapter,
      prevChapter,
      seekDeltaSeconds,
      jumpToSegmentIndex,
      jumpToChapter,
      jumpToBlockSentence,
      updatePreferences,
      setVoiceAndApply,
      setBrowserVoiceAndApply,
      setAudioEngineAndApply,
      setStyleAndApply,
      setSpeed,
      setVolume,
      setSleepTimer,
      setMinimized: setIsMinimized,
      setDrawerOpen,
      retryCurrentSegment,
      updateSessionTranslationMap,
    }),
    [
      session,
      status,
      activeEngine,
      availableBrowserVoices,
      error,
      errorCode,
      preferences,
      isMinimized,
      isDrawerOpen,
      volume,
      currentTime,
      duration,
      sleepRemainingSec,
      activeSegment,
      startBookPlayback,
      startPagePlayback,
      startSelectionPlayback,
      unlockAudio,
      togglePlayPause,
      pausePlayback,
      resumePlayback,
      stopPlayback,
      nextSegment,
      prevSegment,
      nextPageAudio,
      prevPageAudio,
      nextChapter,
      prevChapter,
      seekDeltaSeconds,
      jumpToSegmentIndex,
      jumpToChapter,
      jumpToBlockSentence,
      updatePreferences,
      setVoiceAndApply,
      setBrowserVoiceAndApply,
      setAudioEngineAndApply,
      setStyleAndApply,
      setSpeed,
      setVolume,
      setSleepTimer,
      retryCurrentSegment,
      updateSessionTranslationMap,
    ],
  );

  return <AudiobookContext.Provider value={value}>{children}</AudiobookContext.Provider>;
}

export function useAudiobook() {
  const ctx = useContext(AudiobookContext);
  if (!ctx) {
    throw new Error("useAudiobook must be used within AudiobookProvider");
  }
  return ctx;
}
