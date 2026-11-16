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
  getChapterBlockRange,
  resolveBookChapters,
  type AudioSegment,
} from "@/lib/ai/segments";
import {
  DEFAULT_VOICE_PREFERENCES,
  loadCachedAudioSegment,
  loadVoicePreferencesSync,
  saveCachedAudioSegment,
  saveListeningProgress,
  saveVoicePreferencesSync,
  type ListeningProgressRecord,
  type UserVoicePreferences,
} from "@/lib/ai/cache";
import { AiServiceError, generateSpeechWav } from "@/lib/ai/client";
import type { GeminiPrebuiltVoiceId, NarrationStyleId } from "@/lib/ai/languages";

export type AudiobookStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface AudiobookStartInput {
  bookId: string;
  bookTitle: string;
  author?: string;
  coverUrl?: string | null;
  reflowBook: ReflowBook;
  language: string;
  translatedMap?: Record<string, string>;
  chapterIndex?: number;
  startBlockId?: string;
  startSentenceIndex?: number;
  startPositionSec?: number;
}

export interface AudiobookSession {
  bookId: string;
  bookTitle: string;
  author?: string;
  coverUrl?: string | null;
  reflowBook: ReflowBook;
  chapters: Chapter[];
  currentChapterIndex: number;
  language: string;
  translatedMap?: Record<string, string>;
  segments: AudioSegment[];
  currentSegmentIndex: number;
}

interface AudiobookContextValue {
  session: AudiobookSession | null;
  status: AudiobookStatus;
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
  togglePlayPause: () => void;
  pausePlayback: () => void;
  resumePlayback: () => void;
  stopPlayback: () => void;
  nextSegment: () => void;
  prevSegment: () => void;
  nextChapter: () => void;
  prevChapter: () => void;
  seekDeltaSeconds: (delta: number) => void;
  jumpToSegmentIndex: (index: number) => void;
  jumpToChapter: (chapterIndex: number) => void;
  jumpToBlockSentence: (blockId: string, sentenceIndex?: number) => Promise<void>;
  updatePreferences: (patch: Partial<UserVoicePreferences>) => void;
  setVoiceAndApply: (voiceId: GeminiPrebuiltVoiceId) => void;
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
  const currentObjectUrlRef = useRef<string | null>(null);
  const inflightFetchRef = useRef<Map<string, Promise<Blob>>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<AudiobookSession | null>(null);
  const prefsRef = useRef<UserVoicePreferences>(preferences);
  const statusRef = useRef<AudiobookStatus>(status);
  const sleepTimerModeRef = useRef<number>(preferences.sleepTimerMinutes);
  const lastSavedListenAtRef = useRef<number>(0);

  sessionRef.current = session;
  prefsRef.current = preferences;
  statusRef.current = status;

  const ensureAudioElement = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = "auto";
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  const revokeCurrentUrl = useCallback(() => {
    if (currentObjectUrlRef.current) {
      URL.revokeObjectURL(currentObjectUrlRef.current);
      currentObjectUrlRef.current = null;
    }
  }, []);

  const persistProgressNow = useCallback((sess: AudiobookSession | null, posSec = 0) => {
    if (!sess) return;
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
      const candidates = [sess.segments[fromIndex + 1], sess.segments[fromIndex + 2]].filter(Boolean);
      for (const seg of candidates) {
        void loadCachedAudioSegment(seg.contentHash).then((hit) => {
          if (!hit) {
            void fetchAudioBlob(seg, prefs).catch(() => {
              /* preload failures handled gently when active */
            });
          }
        });
      }
    },
    [fetchAudioBlob],
  );

  const playSegmentAt = useCallback(
    async (targetSession: AudiobookSession, segIndex: number, startSec = 0) => {
      const audio = ensureAudioElement();
      if (!audio) return;

      const seg = targetSession.segments[segIndex];
      if (!seg) return;

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const updatedSession: AudiobookSession = {
        ...targetSession,
        currentSegmentIndex: segIndex,
      };
      sessionRef.current = updatedSession;
      setSession(updatedSession);
      setStatus("loading");
      setError(null);
      setErrorCode(null);
      setCurrentTime(0);
      setDuration(0);

      try {
        const prefs = prefsRef.current;
        const blob = await fetchAudioBlob(seg, prefs, controller.signal);
        if (controller.signal.aborted) return;

        audio.pause();
        revokeCurrentUrl();
        const url = URL.createObjectURL(blob);
        currentObjectUrlRef.current = url;

        audio.src = url;
        audio.volume = volume;
        audio.playbackRate = prefs.preferredSpeed || 1;

        await new Promise<void>((resolve, reject) => {
          const onReady = () => {
            cleanup();
            if (startSec > 0 && Number.isFinite(audio.duration) && startSec < audio.duration) {
              audio.currentTime = startSec;
            }
            resolve();
          };
          const onErr = () => {
            cleanup();
            reject(new Error("Audio element failed to decode speech segment."));
          };
          const cleanup = () => {
            audio.removeEventListener("canplay", onReady);
            audio.removeEventListener("error", onErr);
          };
          audio.addEventListener("canplay", onReady, { once: true });
          audio.addEventListener("error", onErr, { once: true });
          audio.load();
        });

        if (controller.signal.aborted) return;
        await audio.play();
        setStatus("playing");
        persistProgressNow(updatedSession, audio.currentTime);
        preloadNextSegments(updatedSession, segIndex, prefs);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        const message =
          err instanceof Error ? err.message : "Failed to generate narration audio for this segment.";
        const code = err instanceof AiServiceError ? err.code : "TTS_FAILED";
        setError(message);
        setErrorCode(code);
        setStatus("error");
      }
    },
    [ensureAudioElement, fetchAudioBlob, persistProgressNow, preloadNextSegments, revokeCurrentUrl, volume],
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
      let targetChapIdx = Math.max(0, Math.min(input.chapterIndex ?? 0, chapters.length - 1));

      // If starting at a specific blockId, resolve chapter index containing that blockId
      if (input.startBlockId) {
        const blockIdx = input.reflowBook.blocks.findIndex((b) => b.id === input.startBlockId);
        if (blockIdx >= 0) {
          for (let ci = 0; ci < chapters.length; ci++) {
            const nextChap = chapters[ci + 1];
            if (!nextChap || blockIdx < nextChap.blockIndex) {
              targetChapIdx = ci;
              break;
            }
          }
        }
      }

      const built = buildSegmentsForChapter(
        input.reflowBook,
        chapters,
        targetChapIdx,
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

      const newSession: AudiobookSession = {
        bookId: input.bookId,
        bookTitle: input.bookTitle,
        author: input.author,
        coverUrl: input.coverUrl,
        reflowBook: input.reflowBook,
        chapters,
        currentChapterIndex: built.chapterIndex,
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
        currentChapterIndex: built.chapterIndex,
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

    // End of chapter reached
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

  // Attach audio element listeners once
  useEffect(() => {
    const audio = ensureAudioElement();
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      const now = Date.now();
      if (now - lastSavedListenAtRef.current > 3500) {
        lastSavedListenAtRef.current = now;
        persistProgressNow(sessionRef.current, audio.currentTime || 0);
      }
    };
    const onLoadedMeta = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onEnded = () => {
      handleSegmentEnded();
    };
    const onPlay = () => {
      if (statusRef.current !== "loading") setStatus("playing");
    };
    const onPause = () => {
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
    if (audio) {
      audio.pause();
      persistProgressNow(sessionRef.current, audio.currentTime || 0);
    }
    setStatus("paused");
  }, [persistProgressNow]);

  const resumePlayback = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess) return;
    const audio = audioRef.current;
    if (audio && audio.src) {
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
      const audio = audioRef.current;
      const sess = sessionRef.current;
      if (!audio || !sess) return;
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
    [nextSegment, playSegmentAt],
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
      const existingIdx = sess.segments.findIndex(
        (s) => s.blockId === blockId && s.sentenceIndex === sentenceIndex,
      );
      if (existingIdx >= 0) {
        await playSegmentAt(sess, existingIdx, 0);
        return;
      }

      // Otherwise resolve which chapter contains blockId
      const bIdx = sess.reflowBook.blocks.findIndex((b) => b.id === blockId);
      if (bIdx < 0) return;
      let targetChap = 0;
      for (let i = 0; i < sess.chapters.length; i++) {
        const nextC = sess.chapters[i + 1];
        if (!nextC || bIdx < nextC.blockIndex) {
          targetChap = i;
          break;
        }
      }
      const built = buildSegmentsForChapter(
        sess.reflowBook,
        sess.chapters,
        targetChap,
        sess.bookId,
        sess.language,
        prefsRef.current,
        sess.translatedMap,
      );
      if (!built.segments.length) return;
      const segIdx = Math.max(
        0,
        built.segments.findIndex((s) => s.blockId === blockId && s.sentenceIndex === sentenceIndex),
      );
      const nextSess: AudiobookSession = {
        ...sess,
        currentChapterIndex: built.chapterIndex,
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
      const next = { ...prefsRef.current, preferredVoice: voiceId };
      prefsRef.current = next;
      setPreferences(next);
      saveVoicePreferencesSync(next);
      rebuildSegmentsWithPrefs(next);
    },
    [rebuildSegmentsWithPrefs],
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
    },
    [updatePreferences],
  );

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.min(1, Math.max(0, vol));
    setVolumeState(clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
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
    const sess = sessionRef.current;
    if (!sess) return;
    void playSegmentAt(sess, sess.currentSegmentIndex, 0);
  }, [playSegmentAt]);

  const updateSessionTranslationMap = useCallback(
    (bookId: string, language: string, translatedMap: Record<string, string>) => {
      const sess = sessionRef.current;
      if (!sess || sess.bookId !== bookId) return;
      if (sess.language !== language) return;
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
      togglePlayPause,
      pausePlayback,
      resumePlayback,
      stopPlayback,
      nextSegment,
      prevSegment,
      nextChapter,
      prevChapter,
      seekDeltaSeconds,
      jumpToSegmentIndex,
      jumpToChapter,
      jumpToBlockSentence,
      updatePreferences,
      setVoiceAndApply,
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
      togglePlayPause,
      pausePlayback,
      resumePlayback,
      stopPlayback,
      nextSegment,
      prevSegment,
      nextChapter,
      prevChapter,
      seekDeltaSeconds,
      jumpToSegmentIndex,
      jumpToChapter,
      jumpToBlockSentence,
      updatePreferences,
      setVoiceAndApply,
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
