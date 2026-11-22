import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMissingError } from "@/integrations/supabase/config";
import { useBookInteractions } from "@/hooks/useBookInteractions";
import { useReaderBookmarks } from "@/hooks/useReaderBookmarks";
import { recordBookView, recordReadingSessionHeartbeat } from "@/lib/analytics/tracking";
import PDFViewer, { PDFOutlineItem } from "@/components/bookshelf/PDFViewer";
import EPUBViewer, { TocItem, type EpubInlineTranslationResult } from "@/components/bookshelf/EPUBViewer";
import PaginatedReader, { type PaginationInfo } from "@/components/bookshelf/reader/PaginatedReader";
import ReaderSettingsPanel from "@/components/bookshelf/reader/ReaderSettingsPanel";
import ReaderSearchPanel from "@/components/bookshelf/reader/ReaderSearchPanel";
import { useReflowBook } from "@/hooks/useReflowBook";
import { useReaderHighlights } from "@/hooks/useReaderHighlights";
import {
  isDarkReaderTheme,
  READER_THEMES,
  useReaderSettings,
} from "@/lib/reader/settings";
import { loadAnchor, saveAnchor } from "@/lib/reader/cache";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Bookmark, BookmarkCheck, Settings,
  ZoomIn, ZoomOut, Book, List, X, FileText,
  Search, Loader2, MoreVertical, Maximize2, MoveHorizontal
} from "lucide-react";
import { useAudiobook } from "@/contexts/AudiobookContext";
import AudiobookPlayer from "@/components/bookshelf/reader/AudiobookPlayer";
import TranslationPanel from "@/components/bookshelf/reader/TranslationPanel";
import AudioSettingsPanel from "@/components/bookshelf/reader/AudioSettingsPanel";
import BilingualReaderView from "@/components/bookshelf/reader/BilingualReaderView";
import { extractEpubReflow } from "@/lib/reader/epubExtract";
import type { ReflowBook } from "@/lib/reader/types";
import {
  getLanguageMeta,
  type GeminiPrebuiltVoiceId,
  type TranslationQuality,
  type TranslationReadingMode,
} from "@/lib/ai/languages";
import {
  chunkBlocksByBudget,
  extractCandidateGlossaryTerms,
  getChapterBlockRange,
  getPageTextBlocks,
  hashTextContent,
  resolveBookChapters,
} from "@/lib/ai/segments";
import {
  loadCachedTranslation,
  loadDetectedLanguage,
  loadListeningProgress,
  saveCachedTranslation,
  saveDetectedLanguage,
  syncTranslatedChapterRemote,
  type GlossaryEntry,
  type ListeningProgressRecord,
} from "@/lib/ai/cache";
import {
  AiServiceError,
  detectBookLanguage,
  translateBookBatch,
  translateTextQuick,
} from "@/lib/ai/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { StickyBannerAd, BookReaderInlineAd, NativeAdSlot } from "@/components/ads";
import { isNativeAdsSupported } from "@/lib/ads/native/bridge";
import { useIsMobile } from "@/hooks/use-mobile";
import { BOOK_PUBLIC_COLUMNS } from "@/lib/constants/bookshelf";
import { appNavController, useRegisterBackOverlay, useSmartBack } from "@/lib/navigation";

const MOBILE_PANEL_BOTTOM_OFFSET = "calc(112px + env(safe-area-inset-bottom))";
const MOBILE_PANEL_MAX_HEIGHT = "calc(70vh - env(safe-area-inset-bottom))";

const VIEW_MODE_KEY = "shaverse:reader-view-mode:v1";

const getFileType = (url: string | null): "pdf" | "epub" | "unknown" => {
  if (!url) return "unknown";
  const lowerUrl = url.toLowerCase();
  const pathOnly = lowerUrl.split("?")[0];
  if (pathOnly.endsWith(".epub")) return "epub";
  if (pathOnly.endsWith(".pdf")) return "pdf";
  if (lowerUrl.includes(".epub")) return "epub";
  if (lowerUrl.includes(".pdf")) return "pdf";
  if (lowerUrl.includes("/storage/v1/object/")) return "pdf";
  return "unknown";
};


const BookReader = () => {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const handleBack = useSmartBack(bookId ? `/bookshelf/book/${bookId}` : "/bookshelf");
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const epubRef = useRef<HTMLDivElement>(null);
  const lastSavedProgressRef = useRef<string>("");

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [showToc, setShowToc] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [pdfOutline, setPdfOutline] = useState<PDFOutlineItem[]>([]);
  const [epubToc, setEpubToc] = useState<TocItem[]>([]);
  const [activeEpubHref, setActiveEpubHref] = useState<string>("");
  // Zoom factor where 1.0 = fit page/width; up to 3.0 = 300%.
  const [scale, setScale] = useState(1);
  const [pdfFitMode, setPdfFitMode] = useState<"page" | "width">("page");
  const [epubCfi, setEpubCfi] = useState<string | undefined>();
  const [reflowNoticeDismissed, setReflowNoticeDismissed] = useState(false);
  const [noteDraft, setNoteDraft] = useState<{ highlightId: string; text: string; value: string } | null>(null);

  // Web-only legacy reader-ad state. Android uses BS_READER_01 below.
  const [adKey, setAdKey] = useState(0);
  const [adDismissedFor, setAdDismissedFor] = useState<number | null>(null);
  const [nativeAdPage, setNativeAdPage] = useState<number | null>(null);
  const lastDisplayPageRef = useRef<number | null>(null);
  const completedPagesRef = useRef(0);

  const { data: book, isLoading } = useQuery({
    queryKey: ["book", bookId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("books")
        .select(BOOK_PUBLIC_COLUMNS)
        .eq("id", bookId)
        .single();
      if (error) {
        if (isSchemaMissingError(error)) return null;
        throw error;
      }
      return data;
    },
    enabled: !!bookId,
  });

  const { readingProgress, updateProgress } = useBookInteractions(bookId);
  const { bookmarks, addBookmark, removeBookmark, isPageBookmarked, getBookmarkForPage } = useReaderBookmarks(bookId);
  const saveProgressRef = useRef(updateProgress.mutate);

  const fileType = getFileType(book?.book_url);

  /* ------------------------------- Reader Mode ------------------------------ */
  // Reader Mode = reflowable text extracted from the PDF (default).
  // Original PDF Mode = the fixed-layout page renderer.
  const [viewMode, setViewMode] = useState<"reader" | "original">(() => {
    if (typeof window === "undefined") return "reader";
    return window.localStorage.getItem(VIEW_MODE_KEY) === "original" ? "original" : "reader";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [jumpTo, setJumpTo] = useState<{ blockIndex: number; token: number } | null>(null);
  const jumpTokenRef = useRef(0);
  const anchorRestoredRef = useRef(false);
  // Paginated Reader Mode: page/percent come from the renderer itself.
  const [readerPagination, setReaderPagination] = useState<PaginationInfo>({
    page: 1,
    totalPages: 1,
    percent: 0,
    chapterTitle: "",
  });
  const [navRequest, setNavRequest] = useState<{ delta: number; token: number } | null>(null);
  const navTokenRef = useRef(0);
  const requestFlip = useCallback((delta: number) => {
    navTokenRef.current += 1;
    setNavRequest({ delta, token: navTokenRef.current });
  }, []);

  const {
    settings: readerSettings,
    update: updateReaderSetting,
    reset: resetReaderSettings,
  } = useReaderSettings();

  const activeThemePalette = READER_THEMES[readerSettings.theme] ?? READER_THEMES.light;
  const legacyAdTheme: "light" | "dark" | "sepia" = isDarkReaderTheme(readerSettings.theme)
    ? "dark"
    : readerSettings.theme === "sepia" || readerSettings.theme === "warm"
      ? "sepia"
      : "light";

  const audiobook = useAudiobook();
  const [aiExtractionRequested, setAiExtractionRequested] = useState(false);
  const [epubReflowBook, setEpubReflowBook] = useState<ReflowBook | null>(null);
  const [epubExtracting, setEpubExtracting] = useState(false);

  const isReaderMode = fileType === "pdf" && viewMode === "reader";
  const [pdfExtractionArmed, setPdfExtractionArmed] = useState(isReaderMode);
  useEffect(() => {
    if (isReaderMode || aiExtractionRequested) setPdfExtractionArmed(true);
  }, [isReaderMode, aiExtractionRequested]);
  const observedDisplayPage = isReaderMode ? readerPagination.page : currentPage;
  const nativeReaderAdsEnabled = isNativeAdsSupported();

  const reflow = useReflowBook({
    bookId,
    url: book?.book_url ?? undefined,
    title: book?.title,
    author: book?.author,
    enabled: (isReaderMode || aiExtractionRequested || pdfExtractionArmed) && fileType === "pdf" && !!book?.book_url,
    ocr: true,
  });

  const activeReflowBook: ReflowBook | null = useMemo(() => {
    if (fileType === "epub") return epubReflowBook;
    return reflow.book;
  }, [fileType, epubReflowBook, reflow.book]);

  const reflowBookRef = useRef<ReflowBook | null>(reflow.book);
  const reflowStatusRef = useRef(reflow.status);
  reflowBookRef.current = reflow.book;
  reflowStatusRef.current = reflow.status;

  const activeChapters = useMemo(
    () => (activeReflowBook ? resolveBookChapters(activeReflowBook) : []),
    [activeReflowBook],
  );

  // Unified Full-Screen Settings state synced cleanly with `?settings=1` history param
  const showSettingsSheet = useMemo(
    () => new URLSearchParams(location.search).get("settings") === "1",
    [location.search],
  );
  const [settingsTab, setSettingsTab] = useState<"appearance" | "translation" | "audio">(
    "appearance",
  );
  // Translation state
  const [sourceLanguage, setSourceLanguage] = useState<string>("en");
  const [targetLanguage, setTargetLanguage] = useState<string>(
    audiobook.preferences.preferredTargetLanguage || "hi",
  );
  const [translationQuality, setTranslationQuality] = useState<TranslationQuality>("high");
  const [translationReadingMode, setTranslationReadingMode] =
    useState<TranslationReadingMode>("original");
  const [translatedMap, setTranslatedMap] = useState<Record<string, string>>({});
  const [completedChapterIds, setCompletedChapterIds] = useState<string[]>([]);
  const [failedChapterIds, setFailedChapterIds] = useState<string[]>([]);
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
  const [isDetectingLanguage, setIsDetectingLanguage] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<{
    done: number;
    total: number;
    label: string;
  } | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationErrorCode, setTranslationErrorCode] = useState<string | null>(null);
  const [inlineTranslationVisible, setInlineTranslationVisible] = useState<Record<string, boolean>>({});
  const [inlineTranslatingIds, setInlineTranslatingIds] = useState<Record<string, boolean>>({});
  const [inlineTranslateErrors, setInlineTranslateErrors] = useState<Record<string, string>>({});
  const activeTranslationKeyRef = useRef("");
  const translationAbortRef = useRef<AbortController | null>(null);
  const pendingAutoTranslateLangRef = useRef<string | null>(null);
  const pendingAutoStartVoiceRef = useRef<GeminiPrebuiltVoiceId | null>(null);

  // Listening state (synced automatically when user chooses a Translation language)
  const [hasChosenTranslationLanguage, setHasChosenTranslationLanguage] = useState(false);
  const [isPreparingTranslationForAudio, setIsPreparingTranslationForAudio] = useState(false);
  const [savedListenProgress, setSavedListenProgress] =
    useState<ListeningProgressRecord | null>(null);
  const [listenInTranslated, setListenInTranslated] = useState(false);
  const [selectedBookText, setSelectedBookText] = useState("");
  const currentLocationBlockRef = useRef<{ blockId: string; blockIndex: number }>({
    blockId: "",
    blockIndex: 0,
  });

  const { highlights, addHighlight, removeHighlight, updateHighlight } =
    useReaderHighlights(bookId);

  // page -> first block index, for page/bookmark navigation inside Reader Mode.
  const pageStartIndex = useMemo(() => {
    const map = new Map<number, number>();
    reflow.book?.blocks.forEach((block, index) => {
      if (!map.has(block.page)) map.set(block.page, index);
    });
    return map;
  }, [reflow.book]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  useEffect(() => {
    anchorRestoredRef.current = false;
    lastDisplayPageRef.current = null;
    completedPagesRef.current = 0;
    setNativeAdPage(null);
  }, [bookId, isReaderMode]);

  useEffect(() => {
    if (!nativeReaderAdsEnabled || observedDisplayPage < 1) return;
    const previousPage = lastDisplayPageRef.current;
    lastDisplayPageRef.current = observedDisplayPage;
    setNativeAdPage(null);

    // Only a normal forward page turn completes a reading page. Restores,
    // TOC/search jumps, slider seeks, and backwards navigation do not count.
    if (previousPage !== null && observedDisplayPage === previousPage + 1) {
      completedPagesRef.current += 1;
      if (completedPagesRef.current % 2 === 0) setNativeAdPage(observedDisplayPage);
    }
  }, [nativeReaderAdsEnabled, observedDisplayPage]);

  useEffect(() => {
    if (isReaderMode && reflow.totalPages > 0) setTotalPages(reflow.totalPages);
  }, [isReaderMode, reflow.totalPages]);

  const jumpToBlock = useCallback((blockIndex: number) => {
    jumpTokenRef.current += 1;
    setJumpTo({ blockIndex, token: jumpTokenRef.current });
  }, []);

  // Restore the saved reading anchor once enough of the book is available.
  useEffect(() => {
    if (!isReaderMode || !bookId || anchorRestoredRef.current) return;
    const blocks = reflow.book?.blocks;
    if (!blocks?.length) return;

    anchorRestoredRef.current = true;
    void loadAnchor(bookId).then((anchor) => {
      if (!anchor) return;
      const byId = blocks.findIndex((b) => b.id === anchor.blockId);
      const bySnippet =
        byId >= 0
          ? byId
          : blocks.findIndex((b) => "text" in b && anchor.snippet && b.text.startsWith(anchor.snippet));
      const index = bySnippet >= 0 ? bySnippet : pageStartIndex.get(anchor.page) ?? -1;
      if (index >= 0) jumpToBlock(index);
    });
  }, [isReaderMode, bookId, reflow.book, pageStartIndex, jumpToBlock]);

  const handleReaderLocation = useCallback(
    (location: { blockIndex: number; blockId: string; page: number; percent: number; snippet: string }) => {
      currentLocationBlockRef.current = {
        blockId: location.blockId,
        blockIndex: location.blockIndex,
      };
      setCurrentPage((prev) => (prev === location.page ? prev : location.page));
      if (bookId) {
        void saveAnchor(bookId, {
          blockId: location.blockId,
          blockIndex: location.blockIndex,
          charOffset: 0,
          snippet: location.snippet,
          page: location.page,
          updatedAt: Date.now(),
        });
      }
    },
    [bookId]
  );

  // Determine current logical chapter index based on anchor / currentPage
  const currentChapterIndex = useMemo(() => {
    if (!activeChapters.length) return 0;
    const blockIdx = currentLocationBlockRef.current.blockIndex;
    if (blockIdx > 0) {
      let found = 0;
      for (let i = 0; i < activeChapters.length; i++) {
        if (activeChapters[i].blockIndex <= blockIdx) found = i;
        else break;
      }
      return found;
    }
    let byPage = 0;
    for (let i = 0; i < activeChapters.length; i++) {
      if (activeChapters[i].page <= currentPage) byPage = i;
    }
    return byPage;
  }, [activeChapters, currentPage]);

  const hasTextBlocks = useCallback((b: ReflowBook | null | undefined) => {
    return Boolean(b?.blocks.some((blk) => blk.type === "heading" || blk.type === "paragraph"));
  }, []);

  // Ensure structured blocks exist (PDF reflow or EPUB spine extraction) when AI features are requested
  const ensureStructuredBook = useCallback(async (): Promise<ReflowBook | null> => {
    if (fileType === "pdf") {
      if (!aiExtractionRequested) setAiExtractionRequested(true);
      if (!pdfExtractionArmed) setPdfExtractionArmed(true);
      const current = reflowBookRef.current;
      if (current && (hasTextBlocks(current) || reflowStatusRef.current === "ready")) {
        return current;
      }
      // Wait briefly for initial PDF text extraction batches when opened straight to Settings
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        await new Promise((r) => window.setTimeout(r, 180));
        const latest = reflowBookRef.current;
        if (latest && (hasTextBlocks(latest) || reflowStatusRef.current === "ready")) {
          return latest;
        }
        if (reflowStatusRef.current === "error") {
          return latest ?? null;
        }
      }
      return reflowBookRef.current ?? null;
    }
    if (fileType === "epub" && book?.book_url && bookId) {
      if (epubReflowBook && epubReflowBook.blocks.length > 0) return epubReflowBook;
      setEpubExtracting(true);
      try {
        const extracted = await extractEpubReflow({
          bookId,
          url: book.book_url,
          title: book.title,
          author: book.author ?? undefined,
        });
        setEpubReflowBook(extracted);
        return extracted;
      } finally {
        setEpubExtracting(false);
      }
    }
    return null;
  }, [fileType, aiExtractionRequested, pdfExtractionArmed, hasTextBlocks, book?.book_url, book?.title, book?.author, bookId, epubReflowBook]);

  // Load saved detected language and cached translation for current (bookId, targetLanguage, quality)
  useEffect(() => {
    if (!bookId) return;
    let alive = true;
    void loadDetectedLanguage(bookId).then((lang) => {
      if (!alive) return;
      if (lang) setSourceLanguage(lang);
      else if (activeReflowBook?.meta.language) setSourceLanguage(activeReflowBook.meta.language);
    });
    return () => {
      alive = false;
    };
  }, [bookId, activeReflowBook?.meta.language]);

  useEffect(() => {
    if (!bookId) return;
    let alive = true;
    const key = `${bookId}:${targetLanguage}:${translationQuality}`;
    const keyChanged = activeTranslationKeyRef.current !== key;
    activeTranslationKeyRef.current = key;

    if (keyChanged) {
      setInlineTranslationVisible({});
      setInlineTranslatingIds({});
      setInlineTranslateErrors({});
    }

    void loadCachedTranslation(bookId, targetLanguage, translationQuality).then((cached) => {
      if (!alive || activeTranslationKeyRef.current !== key) return;
      if (cached) {
        setTranslatedMap((prev) => ({
          ...(cached.translatedMap || {}),
          ...prev,
        }));
        setCompletedChapterIds(cached.completedChapters || []);
        setFailedChapterIds(cached.failedChapters || []);
        setGlossary(cached.glossary || []);
        if (cached.detectedSourceLanguage) setSourceLanguage(cached.detectedSourceLanguage);
      } else if (keyChanged) {
        setTranslatedMap({});
        setCompletedChapterIds([]);
        setFailedChapterIds([]);
        setGlossary([]);
      }
    });
    return () => {
      alive = false;
    };
  }, [bookId, targetLanguage, translationQuality]);

  const handleAutoDetectSource = useCallback(async () => {
    const structBook = await ensureStructuredBook();
    if (!structBook) return;
    const sample = structBook.blocks
      .filter((b): b is Extract<typeof b, { type: "heading" | "paragraph" }> =>
        b.type === "heading" || b.type === "paragraph",
      )
      .slice(0, 12)
      .map((b) => b.text)
      .join("\n")
      .slice(0, 2800);
    if (!sample) return;

    setIsDetectingLanguage(true);
    setTranslationError(null);
    setTranslationErrorCode(null);
    try {
      const detected = await detectBookLanguage(sample);
      setSourceLanguage(detected.languageCode);
      if (bookId) await saveDetectedLanguage(bookId, detected.languageCode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not auto-detect language.";
      const code = err instanceof AiServiceError ? err.code : "DETECT_FAILED";
      setTranslationError(msg);
      setTranslationErrorCode(code);
    } finally {
      setIsDetectingLanguage(false);
    }
  }, [ensureStructuredBook, bookId]);

  const runChapterTranslation = useCallback(
    async (
      structBook: ReflowBook,
      chapterIndices: number[],
      existingMap: Record<string, string>,
      existingCompleted: string[],
      existingFailed: string[],
      existingGlossary: GlossaryEntry[],
      maxBlocksOverride?: number,
      startOffsetBlockIndex?: number,
      overrideTargetLanguage?: string,
      specificBlocksOverride?: Array<Extract<ReflowBook["blocks"][number], { type: "heading" | "paragraph" }>>,
    ): Promise<Record<string, string>> => {
      if (!bookId) return existingMap;
      const effectiveTargetLang = overrideTargetLanguage || targetLanguage;
      translationAbortRef.current?.abort();
      const controller = new AbortController();
      translationAbortRef.current = controller;

      setIsTranslating(true);
      setTranslationError(null);
      setTranslationErrorCode(null);

      const chapters = resolveBookChapters(structBook);
      const nextMap = { ...existingMap };
      const completedSet = new Set(existingCompleted);
      const failedSet = new Set(existingFailed);
      const glossaryMap = new Map<string, string>(
        existingGlossary.map((g) => [g.source, g.target]),
      );

      if (glossaryMap.size === 0) {
        const candidates = extractCandidateGlossaryTerms(structBook.blocks, 16);
        for (const c of candidates) glossaryMap.set(c, c);
      }

      try {
        // Page / selective block translation mode
        if (typeof maxBlocksOverride === "number" || (specificBlocksOverride && specificBlocksOverride.length > 0)) {
          const fromIdx = Math.max(0, startOffsetBlockIndex ?? 0);
          let sampleBlocks = specificBlocksOverride && specificBlocksOverride.length > 0
            ? specificBlocksOverride
            : structBook.blocks
                .slice(fromIdx)
                .filter((b): b is Extract<typeof b, { type: "heading" | "paragraph" }> =>
                  b.type === "heading" || b.type === "paragraph",
                )
                .slice(0, maxBlocksOverride ?? 8);

          if (sampleBlocks.length === 0) {
            sampleBlocks = structBook.blocks
              .filter((b): b is Extract<typeof b, { type: "heading" | "paragraph" }> =>
                b.type === "heading" || b.type === "paragraph",
              )
              .slice(0, maxBlocksOverride ?? 8);
          }

          if (sampleBlocks.length === 0) {
            setTranslationError("No translatable text paragraphs were found on these pages yet.");
            setTranslationErrorCode("NO_TEXT_CONTENT");
            return nextMap;
          }

          const sampleBatches = chunkBlocksByBudget(sampleBlocks, 4, 4_500);
          const totalBatches = Math.max(1, sampleBatches.length);
          let doneBatches = 0;
          let sampleOffset = 0;

          for (const batch of sampleBatches) {
            if (controller.signal.aborted) break;
            setTranslationProgress({
              done: doneBatches,
              total: totalBatches,
              label: `Translating (${getLanguageMeta(effectiveTargetLang).nativeName})...`,
            });

            const prevCtx =
              sampleOffset > 0
                ? sampleBlocks.slice(Math.max(0, sampleOffset - 2), sampleOffset).map((b) => b.text)
                : structBook.blocks
                    .slice(Math.max(0, fromIdx - 2), fromIdx)
                    .filter((b): b is Extract<typeof b, { type: "paragraph" | "heading" }> =>
                      b.type === "paragraph" || b.type === "heading",
                    )
                    .map((b) => b.text);
            sampleOffset += batch.length;

            const resp = await translateBookBatch({
              bookTitle: book?.title,
              sourceLanguage,
              targetLanguage: effectiveTargetLang,
              quality: translationQuality,
              blocks: batch.map((b) => ({ id: b.id, type: b.type, text: b.text })),
              previousContext: prevCtx,
              glossary: Array.from(glossaryMap.entries()).map(([source, target]) => ({
                source,
                target,
              })),
              signal: controller.signal,
            });

            for (const item of resp.items) {
              nextMap[item.id] = item.translatedText;
            }
            for (const g of resp.glossaryAdditions || []) {
              if (g.source && g.target) glossaryMap.set(g.source, g.target);
            }
            doneBatches += 1;
            setTranslationProgress({
              done: doneBatches,
              total: totalBatches,
              label: `Translated (${doneBatches}/${totalBatches})`,
            });
            setTranslatedMap({ ...nextMap });
            setTranslationReadingMode((prev) => (prev === "original" ? "translated" : prev));
          }

          const updatedGlossary = Array.from(glossaryMap.entries()).map(([source, target]) => ({
            source,
            target,
          }));
          setGlossary(updatedGlossary);
          await saveCachedTranslation({
            bookId,
            sourceLanguage,
            targetLanguage: effectiveTargetLang,
            quality: translationQuality,
            translatedMap: nextMap,
            completedChapters: Array.from(completedSet),
            failedChapters: Array.from(failedSet),
            glossary: updatedGlossary,
            detectedSourceLanguage: sourceLanguage,
            updatedAt: Date.now(),
          });
          audiobook.updateSessionTranslationMap(bookId, effectiveTargetLang, nextMap);
          return nextMap;
        }

        // Chapter-by-chapter full/single-chapter translation
        const total = Math.max(1, chapterIndices.length);
        let doneCount = 0;

        for (const cIdx of chapterIndices) {
          if (controller.signal.aborted) break;
          const range = getChapterBlockRange(structBook, cIdx);
          if (!range) {
            doneCount += 1;
            continue;
          }

          const { chapter, startIndex, endIndex } = range;
          setTranslationProgress({
            done: doneCount,
            total,
            label: `Translating: ${chapter.title}`,
          });

          const textBlocks = structBook.blocks
            .slice(startIndex, endIndex)
            .filter((b): b is Extract<typeof b, { type: "heading" | "paragraph" }> =>
              b.type === "heading" || b.type === "paragraph",
            );

          const chapterBlockMap: Record<string, string> = {};
          let chapterFailed = false;
          const chapterBatches = chunkBlocksByBudget(textBlocks, 10, 16_000);
          let chapterOffset = 0;

          for (const batch of chapterBatches) {
            if (controller.signal.aborted) break;
            try {
              const prevCtx = textBlocks
                .slice(Math.max(0, chapterOffset - 2), chapterOffset)
                .map((b) => b.text);
              chapterOffset += batch.length;
              const resp = await translateBookBatch({
                bookTitle: book?.title,
                sourceLanguage,
                targetLanguage: effectiveTargetLang,
                quality: translationQuality,
                blocks: batch.map((b) => ({ id: b.id, type: b.type, text: b.text })),
                previousContext: prevCtx,
                glossary: Array.from(glossaryMap.entries()).map(([source, target]) => ({
                  source,
                  target,
                })),
                signal: controller.signal,
              });
              for (const item of resp.items) {
                nextMap[item.id] = item.translatedText;
                chapterBlockMap[item.id] = item.translatedText;
              }
              for (const g of resp.glossaryAdditions || []) {
                if (g.source && g.target) glossaryMap.set(g.source, g.target);
              }
              setTranslatedMap({ ...nextMap });
              setTranslationReadingMode((prev) => (prev === "original" ? "translated" : prev));
            } catch (err) {
              if ((err as { name?: string })?.name === "AbortError") throw err;
              chapterFailed = true;
              const code = err instanceof AiServiceError ? err.code : "TRANSLATION_FAILED";
              const msg = err instanceof Error ? err.message : "Translation batch failed.";
              setTranslationError(msg);
              setTranslationErrorCode(code);
              if (code === "AI_NOT_CONFIGURED" || code === "API_KEY_INVALID") {
                failedSet.add(chapter.id);
                setFailedChapterIds(Array.from(failedSet));
                throw err;
              }
              break;
            }
          }

          if (!controller.signal.aborted) {
            if (chapterFailed) {
              failedSet.add(chapter.id);
            } else {
              failedSet.delete(chapter.id);
              completedSet.add(chapter.id);
              const updatedGlossary = Array.from(glossaryMap.entries()).map(
                ([source, target]) => ({ source, target }),
              );
              const contentHash = hashTextContent(
                textBlocks.map((b) => `${b.id}:${b.text}`).join("|"),
              );
              void syncTranslatedChapterRemote({
                bookId,
                sourceLanguage,
                targetLanguage: effectiveTargetLang,
                quality: translationQuality,
                chapterId: chapter.id,
                chapterOrder: cIdx,
                contentHash,
                chapterBlockMap,
                glossary: updatedGlossary,
                status: completedSet.size >= chapters.length ? "completed" : "partial",
              });
            }

            setCompletedChapterIds(Array.from(completedSet));
            setFailedChapterIds(Array.from(failedSet));
          }

          doneCount += 1;
          setTranslationProgress({
            done: doneCount,
            total,
            label: `Finished ${doneCount}/${total} chapters`,
          });

          const updatedGlossary = Array.from(glossaryMap.entries()).map(([source, target]) => ({
            source,
            target,
          }));
          setGlossary(updatedGlossary);
          await saveCachedTranslation({
            bookId,
            sourceLanguage,
            targetLanguage: effectiveTargetLang,
            quality: translationQuality,
            translatedMap: nextMap,
            completedChapters: Array.from(completedSet),
            failedChapters: Array.from(failedSet),
            glossary: updatedGlossary,
            detectedSourceLanguage: sourceLanguage,
            updatedAt: Date.now(),
          });
          audiobook.updateSessionTranslationMap(bookId, effectiveTargetLang, nextMap);
        }

        if (!controller.signal.aborted && Object.keys(nextMap).length > 0) {
          setTranslationReadingMode((prev) => (prev === "original" ? "translated" : prev));
        }
        return nextMap;
      } catch (err) {
        if ((err as { name?: string })?.name !== "AbortError") {
          const code = err instanceof AiServiceError ? err.code : "TRANSLATION_FAILED";
          const msg = err instanceof Error ? err.message : "Translation interrupted.";
          setTranslationError(msg);
          setTranslationErrorCode(code);
        }
        return nextMap;
      } finally {
        if (translationAbortRef.current === controller) {
          setIsTranslating(false);
        }
      }
    },
    [bookId, book?.title, sourceLanguage, targetLanguage, translationQuality, audiobook],
  );

  const handleTranslateSample = useCallback(async () => {
    const structBook = await ensureStructuredBook();
    if (!structBook) {
      setTranslationError("Book text is still preparing. Please try again in a second.");
      return;
    }
    const pageItems = getPageTextBlocks(
      structBook,
      observedDisplayPage,
      currentLocationBlockRef.current.blockIndex,
      8,
    );
    const pageBlocks = pageItems.map((p) => p.block);
    await runChapterTranslation(
      structBook,
      [currentChapterIndex],
      translatedMap,
      completedChapterIds,
      failedChapterIds,
      glossary,
      undefined,
      pageItems[0]?.blockIndex ?? currentLocationBlockRef.current.blockIndex,
      undefined,
      pageBlocks,
    );
  }, [
    ensureStructuredBook,
    observedDisplayPage,
    runChapterTranslation,
    currentChapterIndex,
    translatedMap,
    completedChapterIds,
    failedChapterIds,
    glossary,
  ]);

  const handleTranslateSingleChapter = useCallback(
    async (cIdx: number) => {
      const structBook = await ensureStructuredBook();
      if (!structBook) {
        setTranslationError("Book text is still preparing. Please try again in a second.");
        return;
      }
      await runChapterTranslation(
        structBook,
        [cIdx],
        translatedMap,
        completedChapterIds,
        failedChapterIds,
        glossary,
      );
    },
    [ensureStructuredBook, runChapterTranslation, translatedMap, completedChapterIds, failedChapterIds, glossary],
  );

  const handleTranslateFullBook = useCallback(async () => {
    const structBook = await ensureStructuredBook();
    if (!structBook) {
      setTranslationError("Book text is still preparing. Please try again in a second.");
      return;
    }
    const chapters = resolveBookChapters(structBook);
    const pendingIndices = chapters
      .map((ch, idx) => ({ ch, idx }))
      .filter(({ ch }) => !completedChapterIds.includes(ch.id))
      .map(({ idx }) => idx);
    await runChapterTranslation(
      structBook,
      pendingIndices.length ? pendingIndices : chapters.map((_, idx) => idx),
      translatedMap,
      completedChapterIds,
      failedChapterIds,
      glossary,
    );
  }, [ensureStructuredBook, runChapterTranslation, completedChapterIds, translatedMap, failedChapterIds, glossary]);

  const handleRetryFailedChapters = useCallback(async () => {
    const structBook = await ensureStructuredBook();
    if (!structBook) return;
    const chapters = resolveBookChapters(structBook);
    const retryIndices = chapters
      .map((ch, idx) => ({ ch, idx }))
      .filter(({ ch }) => failedChapterIds.includes(ch.id))
      .map(({ idx }) => idx);
    if (!retryIndices.length) return;
    await runChapterTranslation(
      structBook,
      retryIndices,
      translatedMap,
      completedChapterIds,
      failedChapterIds,
      glossary,
    );
  }, [ensureStructuredBook, runChapterTranslation, failedChapterIds, translatedMap, completedChapterIds, glossary]);

  // ReflowBook transformed with translated text when in Translated-only mode
  const translatedReflowBook: ReflowBook | null = useMemo(() => {
    if (!activeReflowBook) return null;
    if (translationReadingMode !== "translated") return activeReflowBook;
    const tgtMeta = getLanguageMeta(targetLanguage);
    return {
      ...activeReflowBook,
      meta: {
        ...activeReflowBook.meta,
        language: tgtMeta.code,
        dir: Object.keys(translatedMap).length > 0 ? tgtMeta.dir : activeReflowBook.meta.dir,
      },
      blocks: activeReflowBook.blocks.map((block) => {
        if ((block.type === "heading" || block.type === "paragraph") && translatedMap[block.id]) {
          return {
            ...block,
            text: translatedMap[block.id],
            dir: tgtMeta.dir,
          };
        }
        return block;
      }),
    };
  }, [activeReflowBook, translationReadingMode, targetLanguage, translatedMap]);

  const originalBlockTextMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (!activeReflowBook) return map;
    for (const block of activeReflowBook.blocks) {
      if (block.type === "heading" || block.type === "paragraph") {
        map[block.id] = block.text;
      }
    }
    return map;
  }, [activeReflowBook]);

  const handleSelectAndTranslateLanguage = useCallback(
    async (newLangCode: string) => {
      setTargetLanguage(newLangCode);
      setHasChosenTranslationLanguage(true);
      setTranslationError(null);
      setTranslationErrorCode(null);

      const useTranslatedAudio = newLangCode !== sourceLanguage;
      setListenInTranslated(useTranslatedAudio);
      audiobook.updatePreferences({
        preferredTargetLanguage: newLangCode,
        preferredTtsLanguage: newLangCode,
      });

      if (!useTranslatedAudio) {
        pendingAutoTranslateLangRef.current = null;
        setTranslationReadingMode("original");
        return;
      }

      if (!bookId) return;

      const cached = await loadCachedTranslation(bookId, newLangCode, translationQuality);
      const cachedMap = cached?.translatedMap || {};
      const cachedCompleted = cached?.completedChapters || [];
      const cachedFailed = cached?.failedChapters || [];
      const cachedGlossary = cached?.glossary || [];

      if (Object.keys(cachedMap).length > 0) {
        pendingAutoTranslateLangRef.current = null;
        setTranslatedMap(cachedMap);
        setCompletedChapterIds(cachedCompleted);
        setFailedChapterIds(cachedFailed);
        setGlossary(cachedGlossary);
        audiobook.updateSessionTranslationMap(bookId, newLangCode, cachedMap);
        setTranslationReadingMode((prev) => (prev === "original" ? "translated" : prev));
        return;
      }

      const structBook = await ensureStructuredBook();
      if (!structBook || structBook.blocks.length === 0) {
        pendingAutoTranslateLangRef.current = newLangCode;
        return;
      }

      pendingAutoTranslateLangRef.current = null;
      const pageItems = getPageTextBlocks(
        structBook,
        observedDisplayPage,
        currentLocationBlockRef.current.blockIndex,
        8,
      );
      await runChapterTranslation(
        structBook,
        [currentChapterIndex],
        cachedMap,
        cachedCompleted,
        cachedFailed,
        cachedGlossary,
        undefined,
        pageItems[0]?.blockIndex ?? currentLocationBlockRef.current.blockIndex,
        newLangCode,
        pageItems.map((p) => p.block),
      );
    },
    [
      bookId,
      sourceLanguage,
      translationQuality,
      audiobook,
      ensureStructuredBook,
      observedDisplayPage,
      runChapterTranslation,
      currentChapterIndex,
    ],
  );

  // If user selected a language while PDF text extraction was still running, auto-translate as soon as text blocks arrive
  useEffect(() => {
    const pendingLang = pendingAutoTranslateLangRef.current;
    if (!pendingLang || !activeReflowBook || !hasTextBlocks(activeReflowBook)) return;
    pendingAutoTranslateLangRef.current = null;
    const pageItems = getPageTextBlocks(
      activeReflowBook,
      observedDisplayPage,
      currentLocationBlockRef.current.blockIndex,
      8,
    );
    void runChapterTranslation(
      activeReflowBook,
      [currentChapterIndex],
      {},
      [],
      [],
      [],
      undefined,
      pageItems[0]?.blockIndex ?? currentLocationBlockRef.current.blockIndex,
      pendingLang,
      pageItems.map((p) => p.block),
    );
  }, [activeReflowBook, currentChapterIndex, hasTextBlocks, observedDisplayPage, runChapterTranslation]);

  const prepareAudioTabState = useCallback(async () => {
    if (!bookId || !book) return;
    const structBook = await ensureStructuredBook();
    if (!structBook && fileType === "pdf") {
      setAiExtractionRequested(true);
    }
    const saved = await loadListeningProgress(bookId);
    setSavedListenProgress(saved);
    if (
      (hasChosenTranslationLanguage && targetLanguage !== sourceLanguage) ||
      (translationReadingMode !== "original" && Object.keys(translatedMap).length > 0)
    ) {
      setListenInTranslated(true);
    }
  }, [
    bookId,
    book,
    ensureStructuredBook,
    fileType,
    hasChosenTranslationLanguage,
    targetLanguage,
    sourceLanguage,
    translationReadingMode,
    translatedMap,
  ]);

  const handleSelectSettingsTab = useCallback(
    (tab: "appearance" | "translation" | "audio") => {
      setSettingsTab(tab);
      if (fileType === "pdf" && !aiExtractionRequested) {
        setAiExtractionRequested(true);
      }
    },
    [fileType, aiExtractionRequested],
  );

  const openSettingsOverlay = useCallback(() => {
    setShowToc(false);
    setShowBookmarks(false);
    setShowSearch(false);
    if (fileType === "pdf" && !aiExtractionRequested) {
      setAiExtractionRequested(true);
    }

    const params = new URLSearchParams(location.search);
    if (params.get("settings") !== "1") {
      params.set("settings", "1");
      const qs = params.toString();
      navigate(`${location.pathname}${qs ? `?${qs}` : ""}`);
    }
  }, [
    location.pathname,
    location.search,
    navigate,
    fileType,
    aiExtractionRequested,
  ]);

  const closeSettingsOverlay = useCallback(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("settings") !== "1") return;
    if (appNavController.canGoBack()) {
      navigate(-1);
    } else {
      params.delete("settings");
      const qs = params.toString();
      navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  const closeTocOverlay = useCallback(() => setShowToc(false), []);
  const closeBookmarksOverlay = useCallback(() => setShowBookmarks(false), []);
  const closeSearchOverlay = useCallback(() => setShowSearch(false), []);
  const cancelNoteOverlay = useCallback(() => {
    setNoteDraft((curr) => {
      if (curr) removeHighlight(curr.highlightId);
      return null;
    });
  }, [removeHighlight]);

  useRegisterBackOverlay(showToc, "reader-toc", closeTocOverlay);
  useRegisterBackOverlay(showBookmarks, "reader-bookmarks", closeBookmarksOverlay);
  useRegisterBackOverlay(showSearch, "reader-search", closeSearchOverlay);
  useRegisterBackOverlay(showSettingsSheet, "reader-settings", closeSettingsOverlay);
  useRegisterBackOverlay(Boolean(noteDraft), "reader-note-draft", cancelNoteOverlay);

  useEffect(() => {
    if (!showSettingsSheet || typeof document === "undefined") return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [showSettingsSheet]);

  const ensureStructuredBookRef = useRef(ensureStructuredBook);
  const prepareAudioTabStateRef = useRef(prepareAudioTabState);
  ensureStructuredBookRef.current = ensureStructuredBook;
  prepareAudioTabStateRef.current = prepareAudioTabState;

  useEffect(() => {
    if (!showSettingsSheet) return;
    if (settingsTab === "translation") void ensureStructuredBookRef.current();
    else if (settingsTab === "audio") void prepareAudioTabStateRef.current();
  }, [showSettingsSheet, settingsTab, bookId]);

  const resolveAudioLanguageAndMap = useCallback(
    async (
      structBook: ReflowBook,
      startBlockIdx: number,
      overrideWantTranslated?: boolean,
      blocksForPage?: Array<Extract<ReflowBook["blocks"][number], { type: "heading" | "paragraph" }>>,
    ): Promise<{ audioLang: string; audioMap?: Record<string, string> }> => {
      const wantTranslated =
        typeof overrideWantTranslated === "boolean"
          ? overrideWantTranslated && targetLanguage !== sourceLanguage
          : listenInTranslated && targetLanguage !== sourceLanguage;
      if (!wantTranslated || !bookId) {
        return { audioLang: sourceLanguage, audioMap: undefined };
      }

      let currentMap = translatedMap;
      if (Object.keys(currentMap).length === 0) {
        const cached = await loadCachedTranslation(bookId, targetLanguage, translationQuality);
        if (cached && Object.keys(cached.translatedMap || {}).length > 0) {
          currentMap = cached.translatedMap;
          setTranslatedMap(currentMap);
          setCompletedChapterIds(cached.completedChapters || []);
          setFailedChapterIds(cached.failedChapters || []);
          setGlossary(cached.glossary || []);
        }
      }

      const targetBlock = structBook.blocks[startBlockIdx] ?? structBook.blocks.find(
        (b) => b.type === "paragraph" || b.type === "heading",
      );
      const missingBlocks = blocksForPage?.filter((b) => !currentMap[b.id]) ?? [];
      if ((targetBlock && !currentMap[targetBlock.id]) || missingBlocks.length > 0) {
        setIsPreparingTranslationForAudio(true);
        try {
          currentMap = await runChapterTranslation(
            structBook,
            [currentChapterIndex],
            currentMap,
            completedChapterIds,
            failedChapterIds,
            glossary,
            missingBlocks.length > 0 ? undefined : 6,
            startBlockIdx,
            targetLanguage,
            missingBlocks.length > 0 ? missingBlocks : undefined,
          );
        } finally {
          setIsPreparingTranslationForAudio(false);
        }
      }

      if (Object.keys(currentMap).length > 0) {
        return { audioLang: targetLanguage, audioMap: currentMap };
      }
      return { audioLang: sourceLanguage, audioMap: undefined };
    },
    [
      listenInTranslated,
      targetLanguage,
      sourceLanguage,
      bookId,
      translatedMap,
      translationQuality,
      runChapterTranslation,
      currentChapterIndex,
      completedChapterIds,
      failedChapterIds,
      glossary,
    ],
  );

  const handleStartAudioFromChoice = useCallback(
    async (
      mode: "resume" | "reading_pos" | "page" | "chapter" | "beginning",
      overrideWantTranslated?: boolean,
    ) => {
      audiobook.unlockAudio();
      if (!book || !bookId) return;
      const structBook = activeReflowBook && activeReflowBook.blocks.length > 0
        ? activeReflowBook
        : await ensureStructuredBook();
      if (!structBook || structBook.blocks.length === 0) return;

      const pageItems =
        mode === "page"
          ? getPageTextBlocks(
              structBook,
              observedDisplayPage,
              currentLocationBlockRef.current.blockIndex,
              8,
            )
          : [];

      const startIdx =
        mode === "page"
          ? pageItems[0]?.blockIndex ?? currentLocationBlockRef.current.blockIndex
          : mode === "reading_pos"
            ? currentLocationBlockRef.current.blockIndex
            : mode === "chapter"
              ? activeChapters[currentChapterIndex]?.blockIndex ?? 0
              : 0;

      const { audioLang, audioMap } = await resolveAudioLanguageAndMap(
        structBook,
        startIdx,
        overrideWantTranslated,
        mode === "page" ? pageItems.map((p) => p.block) : undefined,
      );

      if (mode === "page") {
        await audiobook.startPagePlayback({
          bookId,
          bookTitle: book.title,
          author: book.author ?? undefined,
          coverUrl: book.cover_url,
          reflowBook: structBook,
          page: observedDisplayPage,
          language: audioLang,
          translatedMap: audioMap,
          fallbackStartBlockIndex: currentLocationBlockRef.current.blockIndex,
        });
        return;
      }

      if (mode === "resume" && savedListenProgress) {
        await audiobook.startBookPlayback({
          bookId,
          bookTitle: book.title,
          author: book.author ?? undefined,
          coverUrl: book.cover_url,
          reflowBook: structBook,
          language: savedListenProgress.language || audioLang,
          translatedMap: savedListenProgress.language === targetLanguage ? audioMap || translatedMap : audioMap,
          chapterIndex: savedListenProgress.chapterIndex,
          chapterId: savedListenProgress.chapterId || undefined,
          startBlockId: savedListenProgress.blockId || undefined,
          startSentenceIndex: savedListenProgress.sentenceIndex,
          startPositionSec: savedListenProgress.playbackPosition,
          scope: "book",
          page: observedDisplayPage,
        });
        return;
      }

      if (mode === "reading_pos") {
        await audiobook.startBookPlayback({
          bookId,
          bookTitle: book.title,
          author: book.author ?? undefined,
          coverUrl: book.cover_url,
          reflowBook: structBook,
          language: audioLang,
          translatedMap: audioMap,
          chapterIndex: currentChapterIndex,
          startBlockId: currentLocationBlockRef.current.blockId || undefined,
          scope: "book",
          page: observedDisplayPage,
        });
        return;
      }

      if (mode === "chapter") {
        await audiobook.startBookPlayback({
          bookId,
          bookTitle: book.title,
          author: book.author ?? undefined,
          coverUrl: book.cover_url,
          reflowBook: structBook,
          language: audioLang,
          translatedMap: audioMap,
          chapterIndex: currentChapterIndex,
          scope: "chapter",
          page: observedDisplayPage,
        });
        return;
      }

      await audiobook.startBookPlayback({
        bookId,
        bookTitle: book.title,
        author: book.author ?? undefined,
        coverUrl: book.cover_url,
        reflowBook: structBook,
        language: audioLang,
        translatedMap: audioMap,
        chapterIndex: 0,
        scope: "book",
        page: 1,
      });
    },
    [
      book,
      bookId,
      ensureStructuredBook,
      activeReflowBook,
      observedDisplayPage,
      activeChapters,
      currentChapterIndex,
      resolveAudioLanguageAndMap,
      savedListenProgress,
      audiobook,
      targetLanguage,
      translatedMap,
    ],
  );

  const resolveEffectiveTargetLang = useCallback(() => {
    if (targetLanguage !== sourceLanguage) return targetLanguage;
    if (
      audiobook.preferences.preferredTargetLanguage &&
      audiobook.preferences.preferredTargetLanguage !== sourceLanguage
    ) {
      return audiobook.preferences.preferredTargetLanguage;
    }
    return sourceLanguage === "en" ? "hi" : "en";
  }, [targetLanguage, sourceLanguage, audiobook.preferences.preferredTargetLanguage]);

  const handleTranslateQuickText = useCallback(
    async (text: string) => {
      const effectiveTargetLang = resolveEffectiveTargetLang();
      if (effectiveTargetLang !== targetLanguage) {
        setTargetLanguage(effectiveTargetLang);
        setHasChosenTranslationLanguage(true);
        setListenInTranslated(true);
        audiobook.updatePreferences({
          preferredTargetLanguage: effectiveTargetLang,
          preferredTtsLanguage: effectiveTargetLang,
        });
      }
      const res = await translateTextQuick({
        text,
        sourceLanguage,
        targetLanguage: effectiveTargetLang,
        quality: translationQuality,
        bookTitle: book?.title,
        glossary: glossary.slice(0, 8),
      });
      return {
        translatedText: res.translatedText,
        dir: res.dir,
        provider: res.provider,
      };
    },
    [
      resolveEffectiveTargetLang,
      targetLanguage,
      sourceLanguage,
      translationQuality,
      book?.title,
      glossary,
      audiobook,
    ],
  );

  const handleSelectionTranslate = useCallback(
    async (text: string) => {
      const effectiveTargetLang = resolveEffectiveTargetLang();
      const res = await handleTranslateQuickText(text);
      const meta = getLanguageMeta(effectiveTargetLang);
      return {
        translatedText: res.translatedText,
        languageCode: meta.code,
        languageName: meta.name,
        nativeName: meta.nativeName,
        dir: res.dir,
      };
    },
    [resolveEffectiveTargetLang, handleTranslateQuickText],
  );

  const handleSelectionAudio = useCallback(
    async (text: string, isTranslated?: boolean, languageOverride?: string) => {
      audiobook.unlockAudio();
      if (!book || !bookId || !text.trim()) return;
      const structBook =
        activeReflowBook && activeReflowBook.blocks.length > 0
          ? activeReflowBook
          : (await ensureStructuredBook()) ?? {
              bookId,
              version: 6,
              meta: {
                title: book.title,
                author: book.author ?? undefined,
                language: sourceLanguage,
                totalPages: Math.max(1, totalPages),
                scanned: false,
                dir: "ltr" as const,
              },
              chapters: [],
              blocks: [],
            };
      const lang =
        languageOverride ||
        (isTranslated ? resolveEffectiveTargetLang() : sourceLanguage);
      await audiobook.startSelectionPlayback({
        bookId,
        bookTitle: book.title,
        author: book.author ?? undefined,
        coverUrl: book.cover_url,
        reflowBook: structBook,
        text: text.trim(),
        language: lang,
        blockId: currentLocationBlockRef.current.blockId || undefined,
        blockIndex: currentLocationBlockRef.current.blockIndex,
        chapterId: activeChapters[currentChapterIndex]?.id,
        chapterTitle: activeChapters[currentChapterIndex]?.title,
        page: observedDisplayPage,
      });
    },
    [
      audiobook,
      book,
      bookId,
      activeReflowBook,
      ensureStructuredBook,
      sourceLanguage,
      totalPages,
      resolveEffectiveTargetLang,
      activeChapters,
      currentChapterIndex,
      observedDisplayPage,
    ],
  );

  const handleListenQuickText = useCallback(
    async (text: string, languageCode: string) => {
      await handleSelectionAudio(text, languageCode !== sourceLanguage, languageCode);
    },
    [handleSelectionAudio, sourceLanguage],
  );

  // Clicking any voice card in Audio Reader immediately applies that voice AND auto-starts book playback in the chosen language
  const handleSelectAndStartVoice = useCallback(
    async (voiceId: GeminiPrebuiltVoiceId) => {
      audiobook.unlockAudio();
      if (!book || !bookId) return;
      audiobook.updatePreferences({ preferredVoice: voiceId });
      const structBook = activeReflowBook && activeReflowBook.blocks.length > 0
        ? activeReflowBook
        : await ensureStructuredBook();
      if (!structBook || structBook.blocks.length === 0) {
        pendingAutoStartVoiceRef.current = voiceId;
        if (fileType === "pdf") setAiExtractionRequested(true);
        return;
      }

      pendingAutoStartVoiceRef.current = null;
      const desiredUseTranslated =
        listenInTranslated && targetLanguage !== sourceLanguage;
      const desiredLang = desiredUseTranslated ? targetLanguage : sourceLanguage;

      if (
        audiobook.session?.bookId === bookId &&
        audiobook.status !== "idle" &&
        audiobook.session.language === desiredLang
      ) {
        audiobook.setVoiceAndApply(voiceId);
        return;
      }

      const startIdx = currentLocationBlockRef.current.blockIndex || 0;
      const { audioLang, audioMap } = await resolveAudioLanguageAndMap(structBook, startIdx);

      await audiobook.startBookPlayback({
        bookId,
        bookTitle: book.title,
        author: book.author ?? undefined,
        coverUrl: book.cover_url,
        reflowBook: structBook,
        language: audioLang,
        translatedMap: audioMap,
        chapterIndex: currentChapterIndex,
        startBlockId: currentLocationBlockRef.current.blockId || undefined,
      });
    },
    [
      book,
      bookId,
      fileType,
      ensureStructuredBook,
      activeReflowBook,
      audiobook,
      listenInTranslated,
      targetLanguage,
      sourceLanguage,
      resolveAudioLanguageAndMap,
      currentChapterIndex,
    ],
  );

  // If user selected a voice while book extraction was still completing, auto-start narration immediately when ready
  useEffect(() => {
    const pendingVoice = pendingAutoStartVoiceRef.current;
    if (!pendingVoice || !activeReflowBook || !hasTextBlocks(activeReflowBook)) return;
    pendingAutoStartVoiceRef.current = null;
    void handleSelectAndStartVoice(pendingVoice);
  }, [activeReflowBook, hasTextBlocks, handleSelectAndStartVoice]);

  const handleSentencePlayRequest = useCallback(
    async (blockId: string, sentenceIndex: number, isTranslatedColumn?: boolean) => {
      audiobook.unlockAudio();
      if (!book || !bookId) return;
      const structBook = activeReflowBook && activeReflowBook.blocks.length > 0
        ? activeReflowBook
        : await ensureStructuredBook();
      if (!structBook) return;

      const wantTranslated =
        isTranslatedColumn !== undefined
          ? isTranslatedColumn && Boolean(translatedMap[blockId])
          : translationReadingMode === "translated" && Boolean(translatedMap[blockId]);

      const lang = wantTranslated ? targetLanguage : sourceLanguage;
      const mapToUse = wantTranslated ? translatedMap : undefined;

      if (
        audiobook.session?.bookId === bookId &&
        audiobook.session.language === lang &&
        audiobook.status !== "idle"
      ) {
        await audiobook.jumpToBlockSentence(blockId, sentenceIndex);
      } else {
        await audiobook.startBookPlayback({
          bookId,
          bookTitle: book.title,
          author: book.author ?? undefined,
          coverUrl: book.cover_url,
          reflowBook: structBook,
          language: lang,
          translatedMap: mapToUse,
          startBlockId: blockId,
          startSentenceIndex: sentenceIndex,
        });
      }
    },
    [
      book,
      bookId,
      ensureStructuredBook,
      activeReflowBook,
      translatedMap,
      translationReadingMode,
      targetLanguage,
      sourceLanguage,
      audiobook,
    ],
  );

  const handleCloseInlineTranslation = useCallback((blockId: string) => {
    setInlineTranslationVisible((prev) => ({ ...prev, [blockId]: false }));
    setInlineTranslateErrors((prev) => {
      if (!prev[blockId]) return prev;
      const next = { ...prev };
      delete next[blockId];
      return next;
    });
  }, []);

  const handleParagraphTranslate = useCallback(
    async (blockId: string) => {
      if (!bookId) return;
      const structBook =
        activeReflowBook && activeReflowBook.blocks.length > 0
          ? activeReflowBook
          : await ensureStructuredBook();
      if (!structBook) return;

      const bIdx = structBook.blocks.findIndex((b) => b.id === blockId);
      if (bIdx < 0) return;
      const block = structBook.blocks[bIdx];
      if (block.type !== "paragraph" && block.type !== "heading") return;

      // Toggle off immediately if already visible
      if (inlineTranslationVisible[blockId]) {
        setInlineTranslationVisible((prev) => ({ ...prev, [blockId]: false }));
        return;
      }

      // Resolve effective target language (avoid no-op same-language pair)
      const effectiveTargetLang =
        targetLanguage !== sourceLanguage
          ? targetLanguage
          : audiobook.preferences.preferredTargetLanguage &&
              audiobook.preferences.preferredTargetLanguage !== sourceLanguage
            ? audiobook.preferences.preferredTargetLanguage
            : sourceLanguage === "en"
              ? "hi"
              : "en";

      let workingMap = translatedMap;
      if (effectiveTargetLang !== targetLanguage) {
        activeTranslationKeyRef.current = `${bookId}:${effectiveTargetLang}:${translationQuality}`;
        setTargetLanguage(effectiveTargetLang);
        setHasChosenTranslationLanguage(true);
        setListenInTranslated(true);
        audiobook.updatePreferences({
          preferredTargetLanguage: effectiveTargetLang,
          preferredTtsLanguage: effectiveTargetLang,
        });
        const cached = await loadCachedTranslation(bookId, effectiveTargetLang, translationQuality);
        workingMap = cached?.translatedMap || {};
        setTranslatedMap(workingMap);
        setCompletedChapterIds(cached?.completedChapters || []);
        setFailedChapterIds(cached?.failedChapters || []);
        setGlossary(cached?.glossary || []);
      }

      // Instantaneous toggle if already cached in memory
      if (workingMap[blockId]) {
        setInlineTranslateErrors((prev) => {
          if (!prev[blockId]) return prev;
          const next = { ...prev };
          delete next[blockId];
          return next;
        });
        setInlineTranslationVisible((prev) => ({ ...prev, [blockId]: true }));
        return;
      }

      if (inlineTranslatingIds[blockId]) return;

      setInlineTranslatingIds((prev) => ({ ...prev, [blockId]: true }));
      setInlineTranslateErrors((prev) => {
        if (!prev[blockId]) return prev;
        const next = { ...prev };
        delete next[blockId];
        return next;
      });

      try {
        const prevCtx = structBook.blocks
          .slice(Math.max(0, bIdx - 1), bIdx)
          .filter(
            (b): b is Extract<typeof b, { type: "paragraph" | "heading" }> =>
              b.type === "paragraph" || b.type === "heading",
          )
          .map((b) => b.text);

        const resp = await translateBookBatch({
          bookTitle: book?.title,
          sourceLanguage,
          targetLanguage: effectiveTargetLang,
          quality: translationQuality,
          blocks: [{ id: block.id, type: block.type, text: block.text }],
          previousContext: prevCtx,
          glossary: glossary.slice(0, 8),
        });

        const translatedText =
          resp.items.find((item) => item.id === block.id)?.translatedText ||
          resp.items[0]?.translatedText;

        if (!translatedText) {
          setInlineTranslateErrors((prev) => ({
            ...prev,
            [blockId]: "No translation was returned for this paragraph.",
          }));
          return;
        }

        let mergedMap: Record<string, string> = {};
        setTranslatedMap((prev) => {
          mergedMap = { ...prev, ...workingMap, [blockId]: translatedText };
          return mergedMap;
        });
        if (Object.keys(mergedMap).length === 0) {
          mergedMap = { ...workingMap, [blockId]: translatedText };
        }

        // Only expand the inline card when the global mode is not already displaying translated text
        if (translationReadingMode !== "translated") {
          setInlineTranslationVisible((prev) => ({ ...prev, [blockId]: true }));
        }

        void saveCachedTranslation({
          bookId,
          sourceLanguage,
          targetLanguage: effectiveTargetLang,
          quality: translationQuality,
          translatedMap: mergedMap,
          completedChapters: completedChapterIds,
          failedChapters: failedChapterIds,
          glossary,
          detectedSourceLanguage: sourceLanguage,
          updatedAt: Date.now(),
        });
        audiobook.updateSessionTranslationMap(bookId, effectiveTargetLang, mergedMap);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Could not translate this paragraph right now.";
        setInlineTranslateErrors((prev) => ({ ...prev, [blockId]: msg }));
      } finally {
        setInlineTranslatingIds((prev) => {
          if (!prev[blockId]) return prev;
          const next = { ...prev };
          delete next[blockId];
          return next;
        });
      }
    },
    [
      bookId,
      book?.title,
      activeReflowBook,
      ensureStructuredBook,
      inlineTranslationVisible,
      inlineTranslatingIds,
      targetLanguage,
      sourceLanguage,
      audiobook,
      translationQuality,
      translatedMap,
      glossary,
      completedChapterIds,
      failedChapterIds,
      translationReadingMode,
    ],
  );

  const handleParagraphAudio = useCallback(
    async (blockId: string, forceTranslated?: boolean) => {
      // Unlock HTMLAudioElement synchronously inside the user tap gesture
      audiobook.unlockAudio();
      if (!book || !bookId) return;

      if (
        audiobook.session?.bookId === bookId &&
        audiobook.activeSegment?.blockId === blockId
      ) {
        if (audiobook.status === "playing") {
          audiobook.pausePlayback();
          return;
        }
        if (audiobook.status === "paused") {
          audiobook.resumePlayback();
          return;
        }
        if (audiobook.status === "loading") {
          return;
        }
      }

      const structBook =
        activeReflowBook && activeReflowBook.blocks.length > 0
          ? activeReflowBook
          : await ensureStructuredBook();
      if (!structBook) return;

      const useTranslated =
        typeof forceTranslated === "boolean"
          ? forceTranslated && Boolean(translatedMap[blockId])
          : Boolean(
              (inlineTranslationVisible[blockId] || translationReadingMode === "translated") &&
                translatedMap[blockId],
            );

      const lang = useTranslated ? targetLanguage : sourceLanguage;
      const mapToUse = useTranslated ? translatedMap : undefined;
      setListenInTranslated(useTranslated);

      const canReuseSession =
        audiobook.session?.bookId === bookId &&
        audiobook.session.language === lang &&
        audiobook.status !== "idle" &&
        (!useTranslated || audiobook.session.translatedMap?.[blockId] === translatedMap[blockId]);

      if (canReuseSession) {
        await audiobook.jumpToBlockSentence(blockId, 0);
      } else {
        await audiobook.startBookPlayback({
          bookId,
          bookTitle: book.title,
          author: book.author ?? undefined,
          coverUrl: book.cover_url,
          reflowBook: structBook,
          language: lang,
          translatedMap: mapToUse,
          startBlockId: blockId,
          startSentenceIndex: 0,
        });
      }
    },
    [
      audiobook,
      book,
      bookId,
      activeReflowBook,
      ensureStructuredBook,
      translatedMap,
      inlineTranslationVisible,
      translationReadingMode,
      targetLanguage,
      sourceLanguage,
    ],
  );

  const epubInlineTrCacheRef = useRef<Map<string, EpubInlineTranslationResult>>(new Map());

  const handleEpubParagraphTranslate = useCallback(
    async (paragraphText: string): Promise<EpubInlineTranslationResult> => {
      const normalized = paragraphText.replace(/\s+/g, " ").trim();
      const effectiveTargetLang =
        targetLanguage !== sourceLanguage
          ? targetLanguage
          : audiobook.preferences.preferredTargetLanguage &&
              audiobook.preferences.preferredTargetLanguage !== sourceLanguage
            ? audiobook.preferences.preferredTargetLanguage
            : sourceLanguage === "en"
              ? "hi"
              : "en";

      if (effectiveTargetLang !== targetLanguage) {
        setTargetLanguage(effectiveTargetLang);
        setHasChosenTranslationLanguage(true);
        setListenInTranslated(true);
        audiobook.updatePreferences({
          preferredTargetLanguage: effectiveTargetLang,
          preferredTtsLanguage: effectiveTargetLang,
        });
      }

      const tgtMeta = getLanguageMeta(effectiveTargetLang);
      const cacheKey = `${bookId || "book"}:${effectiveTargetLang}:${normalized}`;
      const cached = epubInlineTrCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const resp = await translateBookBatch({
        bookTitle: book?.title,
        sourceLanguage,
        targetLanguage: effectiveTargetLang,
        quality: translationQuality,
        blocks: [{ id: "epub-inline-0", type: "paragraph", text: normalized }],
        glossary: glossary.slice(0, 8),
      });

      const translatedText =
        resp.items[0]?.translatedText || "No translation returned for this paragraph.";
      const result: EpubInlineTranslationResult = {
        translatedText,
        languageName: tgtMeta.name,
        nativeName: tgtMeta.nativeName,
        dir: tgtMeta.dir,
      };
      epubInlineTrCacheRef.current.set(cacheKey, result);
      return result;
    },
    [
      bookId,
      book?.title,
      targetLanguage,
      sourceLanguage,
      translationQuality,
      glossary,
      audiobook,
    ],
  );

  const handleEpubParagraphAudio = useCallback(
    async (paragraphText: string) => {
      audiobook.unlockAudio();
      if (!book || !bookId) return;
      const structBook =
        activeReflowBook && activeReflowBook.blocks.length > 0
          ? activeReflowBook
          : await ensureStructuredBook();
      if (!structBook) return;

      const normTarget = paragraphText.replace(/\s+/g, " ").trim().toLowerCase();
      const snippet = normTarget.slice(0, 60);
      const matched =
        structBook.blocks.find(
          (b) =>
            (b.type === "paragraph" || b.type === "heading") &&
            b.text.replace(/\s+/g, " ").trim().toLowerCase() === normTarget,
        ) ||
        structBook.blocks.find(
          (b) =>
            (b.type === "paragraph" || b.type === "heading") &&
            snippet.length > 8 &&
            b.text.replace(/\s+/g, " ").trim().toLowerCase().includes(snippet),
        ) ||
        structBook.blocks.find((b) => b.type === "paragraph" || b.type === "heading");

      if (matched) {
        await handleParagraphAudio(matched.id);
      }
    },
    [audiobook, book, bookId, activeReflowBook, ensureStructuredBook, handleParagraphAudio],
  );

  const handleCreateHighlight = useCallback(
    (payload: { blockId: string; start: number; end: number; text: string; withNote: boolean }) => {
      const created = addHighlight({
        blockId: payload.blockId,
        start: payload.start,
        end: payload.end,
        text: payload.text,
      });
      if (created && payload.withNote) {
        setNoteDraft({ highlightId: created.id, text: payload.text, value: "" });
      }
    },
    [addHighlight]
  );


  useEffect(() => {
    saveProgressRef.current = updateProgress.mutate;
  }, [updateProgress.mutate]);

  // Load saved progress
  useEffect(() => {
    const savedPage = readingProgress?.current_page;
    const savedTotalPages = readingProgress?.total_pages;

    if (savedPage && savedPage > 0) {
      setCurrentPage(savedPage);
    }

    if (savedTotalPages && savedTotalPages > 0) {
      setTotalPages(savedTotalPages);
    }

    if (savedPage && savedTotalPages) {
      lastSavedProgressRef.current = `${savedPage}:${savedTotalPages}`;
    }
  }, [readingProgress]);

  useEffect(() => {
    if (!totalPages && book?.pages && book.pages > 0) {
      setTotalPages(book.pages);
    }
  }, [book?.pages, totalPages]);

  // Save progress without creating a refetch loop
  useEffect(() => {
    if (!bookId || currentPage < 1 || totalPages < 1) return;

    const progressKey = `${currentPage}:${totalPages}`;
    if (lastSavedProgressRef.current === progressKey) return;

    const timeout = window.setTimeout(() => {
      if (lastSavedProgressRef.current === progressKey) return;
      lastSavedProgressRef.current = progressKey;
      saveProgressRef.current({ currentPage, totalPages });
    }, 600);

    return () => window.clearTimeout(timeout);
  }, [currentPage, totalPages, bookId]);

  // Deduplicated view count & non-intrusive active reading session heartbeat
  useEffect(() => {
    if (!bookId) return;
    void recordBookView(bookId).then((counted) => {
      if (counted) {
        queryClient.invalidateQueries({ queryKey: ["book", bookId] });
        queryClient.invalidateQueries({ queryKey: ["channel-analytics-raw"] });
        queryClient.invalidateQueries({ queryKey: ["book-analytics-raw", bookId] });
      }
    });
  }, [bookId, queryClient]);

  const readingPagesSeenRef = useRef<Set<number>>(new Set());
  const readingFlushedPagesCountRef = useRef(0);
  const readingLastFlushMsRef = useRef<number>(Date.now());

  useEffect(() => {
    const activePage = isReaderMode ? readerPagination.page : currentPage;
    if (activePage > 0) {
      readingPagesSeenRef.current.add(activePage);
    }
  }, [isReaderMode, readerPagination.page, currentPage]);

  useEffect(() => {
    if (!bookId) return;
    readingLastFlushMsRef.current = Date.now();
    readingPagesSeenRef.current = new Set();
    readingFlushedPagesCountRef.current = 0;

    const flushSession = () => {
      const now = Date.now();
      const elapsedSec = Math.floor((now - readingLastFlushMsRef.current) / 1000);
      const totalSeen = readingPagesSeenRef.current.size;
      const deltaPages = Math.max(0, totalSeen - readingFlushedPagesCountRef.current);

      if (elapsedSec >= 3 || deltaPages > 0) {
        const boundedSeconds = Math.min(Math.max(elapsedSec, 1), 120);
        readingLastFlushMsRef.current = now;
        readingFlushedPagesCountRef.current = totalSeen;
        void recordReadingSessionHeartbeat({
          bookId,
          deltaSeconds: boundedSeconds,
          pagesRead: deltaPages,
        });
      }
    };

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        flushSession();
      } else {
        readingLastFlushMsRef.current = Date.now();
      }
    }, 15000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushSession();
      } else {
        readingLastFlushMsRef.current = Date.now();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushSession();
    };
  }, [bookId]);

  // 📖 Re-mount the inline ad whenever the user lands on a "trigger" page,
  // so a fresh creative is fetched each time.
  useEffect(() => {
    setAdKey((k) => k + 1);
    // Reset dismissal when user moves to a new trigger page
    if (adDismissedFor !== null && adDismissedFor !== currentPage) {
      setAdDismissedFor(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // 📖 Compute whether the current page is an ad-eligible page.
  // Rules (from strategy):
  //   - First 2 pages → NO ADS
  //   - Last page → NO ADS
  //   - Every 4 pages thereafter → INLINE AD
  //   - Every ~10% milestone → CHAPTER-END style (HIGH-MONEY spot)
  const isInlineAdPage =
    totalPages > 6 &&
    currentPage > 2 &&
    currentPage < totalPages &&
    (currentPage - 2) % 4 === 0;

  const isChapterEndAdPage =
    totalPages > 12 &&
    currentPage > 4 &&
    currentPage < totalPages &&
    Math.abs((currentPage / totalPages) * 10 - Math.round((currentPage / totalPages) * 10)) < 0.05 &&
    Math.round((currentPage / totalPages) * 10) % 2 === 0; // every ~20%

  const showReaderAd = (isInlineAdPage || isChapterEndAdPage) && adDismissedFor !== currentPage;

  const goToPage = useCallback((page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      if (isReaderMode) {
        const index = pageStartIndex.get(page);
        if (index !== undefined) jumpToBlock(index);
      }
    }
  }, [totalPages, isReaderMode, pageStartIndex, jumpToBlock]);

  const handleTotalPagesChange = useCallback((pages: number) => {
    setTotalPages(pages);
  }, []);

  const handleOutlineExtracted = useCallback((outline: PDFOutlineItem[]) => {
    setPdfOutline(outline);
  }, []);

  const handleEpubTocExtracted = useCallback((toc: TocItem[]) => {
    setEpubToc(toc);
  }, []);

  const handleEpubLocationChange = useCallback((cfi: string, page: number, total: number, href?: string) => {
    setEpubCfi(cfi);
    setCurrentPage(page);
    setTotalPages(total);
    if (href) setActiveEpubHref(href);
  }, []);

  const toggleControls = () => setShowControls((prev) => !prev);

  // Auto-hide controls after 3s of inactivity (disabled while Settings is open)
  useEffect(() => {
    if (!showControls || showSettingsSheet) return;
    const timer = window.setTimeout(() => setShowControls(false), 3000);
    return () => window.clearTimeout(timer);
  }, [showControls, showSettingsSheet, currentPage, readerPagination.page]);

  type EpubMethods = {
    nextPage: () => void;
    prevPage: () => void;
    goToHref: (href: string) => void;
    goToCfi: (cfi: string) => void;
  };
  const getEpubMethods = useCallback((): EpubMethods | undefined => {
    return (epubRef.current as (HTMLDivElement & { __epubMethods?: EpubMethods }) | null)
      ?.__epubMethods;
  }, []);

  // EPUB navigation
  const epubNext = useCallback(() => {
    getEpubMethods()?.nextPage();
  }, [getEpubMethods]);
  const epubPrev = useCallback(() => {
    getEpubMethods()?.prevPage();
  }, [getEpubMethods]);
  const epubGoToHref = useCallback(
    (href: string) => {
      getEpubMethods()?.goToHref(href);
    },
    [getEpubMethods],
  );
  const epubGoToCfi = useCallback(
    (cfi: string) => {
      getEpubMethods()?.goToCfi(cfi);
    },
    [getEpubMethods],
  );

  // Keyboard navigation (desktop): ArrowLeft/Right to flip, Escape closes top overlay or toggles controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (appNavController.popOverlay()) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        setShowControls((prev) => !prev);
        return;
      }

      if (showSettingsSheet) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        if (isReaderMode) requestFlip(-1);
        else if (fileType === "epub") epubPrev();
        else setCurrentPage((p) => Math.max(1, p - 1));
        setShowControls(true);
      } else if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && isReaderMode)) {
        e.preventDefault();
        if (isReaderMode) requestFlip(1);
        else if (fileType === "epub") epubNext();
        else setCurrentPage((p) => (totalPages > 0 ? Math.min(totalPages, p + 1) : p + 1));
        setShowControls(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fileType, totalPages, isReaderMode, showSettingsSheet, requestFlip, epubNext, epubPrev]);

  const handleBookmarkToggle = () => {
    if (isPageBookmarked(currentPage)) {
      const bm = getBookmarkForPage(currentPage);
      if (bm) removeBookmark.mutate(bm.id);
    } else {
      addBookmark.mutate({
        location: fileType === "epub" && epubCfi ? { cfi: epubCfi } : { page: currentPage },
        label: `Page ${currentPage}`,
      });
    }
  };

  const renderOutlineItems = (items: PDFOutlineItem[], depth = 0) => {
    return items.map((item, index) => (
      <div key={`${item.title}-${index}`}>
        <Button
          variant="ghost"
          className="w-full justify-start text-left"
          style={{ paddingLeft: `${16 + depth * 16}px` }}
          onClick={() => { goToPage(item.pageNumber); setShowToc(false); }}
        >
          <span className="truncate">{item.title}</span>
          <span className="ml-auto text-xs text-muted-foreground">p.{item.pageNumber}</span>
        </Button>
        {item.items && item.items.length > 0 && renderOutlineItems(item.items, depth + 1)}
      </div>
    ));
  };

  const renderEpubTocItems = (items: TocItem[], depth = 0) => {
    return items.map((item, index) => {
      const isActiveChapter = Boolean(
        activeEpubHref && item.href && (activeEpubHref.includes(item.href) || item.href.includes(activeEpubHref))
      );
      return (
        <div key={`${item.label}-${index}`}>
          <Button
            variant={isActiveChapter ? "secondary" : "ghost"}
            className={cn("w-full justify-start text-left", isActiveChapter && "font-semibold")}
            style={{ paddingLeft: `${16 + depth * 16}px` }}
            onClick={() => { epubGoToHref(item.href); setShowToc(false); }}
          >
            <span className="truncate">{item.label}</span>
          </Button>
          {item.subitems && item.subitems.length > 0 && renderEpubTocItems(item.subitems, depth + 1)}
        </div>
      );
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <Book className="w-16 h-16 text-muted-foreground mb-4" />
        <h1 className="text-xl font-semibold">Book not found</h1>
        <Button variant="link" onClick={() => navigate("/bookshelf")}>Back to Bookshelf</Button>
      </div>
    );
  }

  const progressPercent = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;
  // Reader Mode shows real rendered pages; other modes show source pages.
  const displayPage = isReaderMode ? readerPagination.page : currentPage;
  const displayTotal = isReaderMode ? readerPagination.totalPages : totalPages;
  const displayPercent = isReaderMode ? readerPagination.percent : progressPercent;
  const isCurrentPageBookmarked = isPageBookmarked(currentPage);
  const showNativeReaderAd = nativeReaderAdsEnabled && nativeAdPage === displayPage;

  return (
    <div
      className="fixed inset-0 w-screen overflow-hidden transition-colors duration-300"
      style={{
        height: "100dvh",
        backgroundColor: activeThemePalette.bg,
        color: activeThemePalette.text,
      }}
      onClick={toggleControls}
    >
      {/* Top Bar */}
      <header
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-transform duration-300 backdrop-blur-sm border-b",
          showControls ? "translate-y-0" : "-translate-y-full"
        )}
        onClick={(e) => e.stopPropagation()}
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          backgroundColor: activeThemePalette.chromeBg,
          borderColor: activeThemePalette.border,
          color: activeThemePalette.text,
        }}
      >
        <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back"
              onClick={() => handleBack()}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="font-semibold truncate max-w-[32vw] sm:max-w-[280px] text-sm sm:text-base">{book.title}</h1>
              <p className="truncate max-w-[32vw] sm:max-w-[280px] text-[11px] opacity-75">
                {isReaderMode && readerPagination.chapterTitle
                  ? readerPagination.chapterTitle
                  : book.author}
                {" · "}
                {displayPercent}%
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {fileType === "pdf" && (
              <>
                {isReaderMode ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Search in book"
                    onClick={() => { setShowSearch(true); setShowToc(false); setShowBookmarks(false); }}
                  >
                    <Search className="w-5 h-5" />
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={pdfFitMode === "page" ? "Fit to width" : "Fit full page"}
                      title={pdfFitMode === "page" ? "Fit Width" : "Fit Page"}
                      onClick={() => {
                        setPdfFitMode((m) => (m === "page" ? "width" : "page"));
                        setScale(1);
                      }}
                    >
                      {pdfFitMode === "page" ? (
                        <MoveHorizontal className="w-5 h-5" />
                      ) : (
                        <Maximize2 className="w-5 h-5" />
                      )}
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => setScale(prev => Math.max(prev - 0.25, 1))}>
                      <ZoomOut className="w-5 h-5" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => setScale(prev => Math.min(prev + 0.25, 3))}>
                      <ZoomIn className="w-5 h-5" />
                    </Button>
                  </>
                )}
              </>
            )}

            {/* Bookmark Toggle */}
            <Button
              variant="ghost"
              size="icon"
              aria-label={isCurrentPageBookmarked ? "Remove page bookmark" : "Bookmark this page"}
              onClick={handleBookmarkToggle}
            >
              {isCurrentPageBookmarked ? (
                <BookmarkCheck className="w-5 h-5 text-yellow-500 fill-yellow-500" />
              ) : (
                <Bookmark className="w-5 h-5" />
              )}
            </Button>

            {/* TOC (desktop inline; mobile inside overflow menu) */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Table of Contents"
              className="hidden sm:flex"
              onClick={() => { setShowToc(!showToc); setShowBookmarks(false); }}
            >
              <List className="w-5 h-5" />
            </Button>

            {/* Bookmarks List (desktop inline; mobile inside overflow menu) */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Bookmarks and highlights"
              className="hidden sm:flex"
              onClick={() => { setShowBookmarks(!showBookmarks); setShowToc(false); }}
            >
              <Bookmark className="w-5 h-5" />
            </Button>

            {/* Mobile overflow menu: TOC + Bookmarks list */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="sm:hidden" aria-label="More options">
                  <MoreVertical className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[60]">
                <DropdownMenuItem onClick={() => { setShowToc(true); setShowBookmarks(false); }}>
                  <List className="w-4 h-4 mr-2" />
                  Table of Contents
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setShowBookmarks(true); setShowToc(false); }}>
                  <Bookmark className="w-4 h-4 mr-2" />
                  Bookmarks
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Full-Screen Settings Screen Trigger */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Reading settings"
              aria-expanded={showSettingsSheet}
              onClick={openSettingsOverlay}
            >
              <Settings className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Full-Screen Responsive Book Settings Overlay (Desktop / Tablet / Mobile) */}
      {showSettingsSheet && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Reading Settings"
          data-testid="book-settings-screen"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "fixed inset-0 z-[70] w-screen h-[100dvh] flex flex-col overflow-hidden bg-background text-foreground",
            isDarkReaderTheme(readerSettings.theme) && "dark",
          )}
        >
          {/* Sticky Header with explicit Back & Close returning cleanly to the open book */}
          <div
            className="shrink-0 border-b border-border bg-background/95 backdrop-blur-sm"
            style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
          >
            <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-3 sm:px-6">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={closeSettingsOverlay}
                aria-label="Back to book"
                className="gap-1.5 px-2.5 text-sm font-medium shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back</span>
              </Button>

              <div className="min-w-0 flex-1 text-center">
                <h2 className="text-sm sm:text-base font-semibold leading-tight truncate">
                  Reading Settings
                </h2>
                <p className="text-[11px] text-muted-foreground truncate">
                  {book.title}
                </p>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={closeSettingsOverlay}
                aria-label="Close reading settings"
                className="gap-1.5 px-2.5 text-sm font-medium shrink-0"
              >
                <span>Close</span>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Text-only settings tabs (zero icons) */}
            <div className="mx-auto max-w-5xl px-3 sm:px-6 pb-3">
              <div
                role="tablist"
                aria-label="Reader settings sections"
                className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 max-w-xl mx-auto"
              >
                {(
                  [
                    { id: "appearance", label: "Appearance" },
                    { id: "translation", label: "Translation" },
                    { id: "audio", label: "Audio Reader" },
                  ] as const
                ).map((tab) => {
                  const active = settingsTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => handleSelectSettingsTab(tab.id)}
                      className={cn(
                        "rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-colors text-center",
                        active
                          ? "bg-background text-foreground shadow-sm font-semibold"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Scrollable Responsive Settings Workspace */}
          <div
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
            style={{ paddingBottom: "max(28px, env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-5 sm:py-6">
              {settingsTab === "appearance" && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  <div className="lg:col-span-7 rounded-xl border border-border/70 bg-card px-4 sm:px-5">
                    <ReaderSettingsPanel
                      settings={readerSettings}
                      onChange={updateReaderSetting}
                      onReset={resetReaderSettings}
                      engineMode={isReaderMode ? "reflow" : fileType === "epub" ? "epub" : "pdf-original"}
                    />
                  </div>

                  <div className="lg:col-span-5 rounded-xl border border-border/70 bg-card p-4 sm:p-5 space-y-5">
                    {/* Zoom & Fit Mode (Original PDF mode only) */}
                    {fileType === "pdf" && !isReaderMode && (
                      <>
                        <div>
                          <label className="text-sm font-medium mb-2.5 block">Page fit</label>
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              variant={pdfFitMode === "page" ? "default" : "outline"}
                              size="sm"
                              onClick={() => { setPdfFitMode("page"); setScale(1); }}
                            >
                              Fit Page
                            </Button>
                            <Button
                              variant={pdfFitMode === "width" ? "default" : "outline"}
                              size="sm"
                              onClick={() => { setPdfFitMode("width"); setScale(1); }}
                            >
                              Fit Width
                            </Button>
                          </div>
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-3 block">Zoom: {Math.round(scale * 100)}%</label>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold opacity-75">−</span>
                            <Slider
                              value={[scale * 100]}
                              onValueChange={(v) => setScale(v[0] / 100)}
                              min={100}
                              max={300}
                              step={25}
                            />
                            <span className="text-sm font-semibold opacity-75">+</span>
                          </div>
                        </div>
                        <Separator />
                      </>
                    )}

                    {/* Go to Page */}
                    <div>
                      <label className="text-sm font-medium mb-3 block">Go to source page</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          aria-label="Go to source page"
                          value={currentPage}
                          onChange={(e) => {
                            const page = parseInt(e.target.value) || 1;
                            goToPage(page);
                          }}
                          min={1}
                          max={Math.max(totalPages, 1)}
                          className="w-24 px-3 py-2 border rounded-md text-center bg-background"
                        />
                        <span className="text-muted-foreground text-sm">of {Math.max(totalPages, 1)}</span>
                      </div>
                    </div>

                    {/* Reading Progress */}
                    <div>
                      <label className="text-sm font-medium mb-2 block">Overall progress</label>
                      <div className="w-full bg-muted rounded-full h-2.5">
                        <div
                          className="bg-primary h-2.5 rounded-full transition-all"
                          style={{ width: `${displayPercent}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{displayPercent}% complete</p>
                    </div>

                    {/* Display Mode (Flow / Original) & More Tools (Translation / Audio Reader) — zero icons */}
                    {(fileType === "pdf" || fileType === "epub") && (
                      <>
                        <Separator />
                        <div className="space-y-4">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wider opacity-70 mb-2">
                              Display mode
                            </p>
                            {fileType === "pdf" ? (
                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                  type="button"
                                  variant={isReaderMode ? "default" : "outline"}
                                  size="sm"
                                  aria-label="Switch to Flow display mode"
                                  aria-pressed={isReaderMode}
                                  onClick={() => setViewMode("reader")}
                                  className="h-9 text-xs font-medium"
                                >
                                  Flow
                                </Button>
                                <Button
                                  type="button"
                                  variant={!isReaderMode ? "default" : "outline"}
                                  size="sm"
                                  aria-label="Switch to Original PDF display mode"
                                  aria-pressed={!isReaderMode}
                                  onClick={() => {
                                    setTranslationReadingMode("original");
                                    setViewMode("original");
                                  }}
                                  className="h-9 text-xs font-medium"
                                >
                                  Original
                                </Button>
                              </div>
                            ) : (
                              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                                Flow (EPUB Adaptive Reading active)
                              </div>
                            )}
                          </div>

                          <div>
                            <p className="text-xs font-medium uppercase tracking-wider opacity-70 mb-2">
                              More tools
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleSelectSettingsTab("translation")}
                                className="h-9 text-xs font-medium"
                              >
                                Translation
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleSelectSettingsTab("audio")}
                                className="h-9 text-xs font-medium"
                              >
                                Audio Reader
                              </Button>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {settingsTab === "translation" && (
                <div className="mx-auto max-w-2xl">
                  {fileType === "pdf" || fileType === "epub" ? (
                    <>
                      {!activeReflowBook && (reflow.status === "extracting" || epubExtracting) && (
                        <div className="mb-3 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs">
                          {epubExtracting
                            ? "Preparing EPUB chapters for translation..."
                            : `Preparing book text (${reflow.progress}%)...`}
                        </div>
                      )}
                      <TranslationPanel
                        sourceLanguage={sourceLanguage}
                        onChangeSourceLanguage={(code) => {
                          setSourceLanguage(code);
                          if (bookId) void saveDetectedLanguage(bookId, code);
                        }}
                        onAutoDetectSource={() => void handleAutoDetectSource()}
                        isDetectingLanguage={isDetectingLanguage}
                        targetLanguage={targetLanguage}
                        onSelectAndTranslateLanguage={(code) => void handleSelectAndTranslateLanguage(code)}
                        quality={translationQuality}
                        onChangeQuality={setTranslationQuality}
                        readingMode={translationReadingMode}
                        onChangeReadingMode={setTranslationReadingMode}
                        chapters={activeChapters}
                        completedChapterIds={completedChapterIds}
                        failedChapterIds={failedChapterIds}
                        currentChapterIndex={currentChapterIndex}
                        displayPage={displayPage}
                        isTranslating={isTranslating}
                        translationProgress={translationProgress}
                        translationError={translationError}
                        translationErrorCode={translationErrorCode}
                        hasTranslatedSample={Object.keys(translatedMap).length > 0}
                        initialQuickText={selectedBookText}
                        onTranslateQuickText={handleTranslateQuickText}
                        onListenQuickText={(text, lang) => void handleListenQuickText(text, lang)}
                        onTranslateSample={() => void handleTranslateSample()}
                        onTranslateChapter={(idx) => void handleTranslateSingleChapter(idx)}
                        onTranslateFullBook={() => void handleTranslateFullBook()}
                        onPauseTranslation={() => {
                          translationAbortRef.current?.abort();
                          setIsTranslating(false);
                        }}
                        onRetryFailed={() => void handleRetryFailedChapters()}
                        onListenOriginal={() => {
                          setListenInTranslated(false);
                          handleSelectSettingsTab("audio");
                          void handleStartAudioFromChoice("reading_pos", false);
                        }}
                        onListenTranslated={() => {
                          setListenInTranslated(true);
                          handleSelectSettingsTab("audio");
                          void handleStartAudioFromChoice("reading_pos", true);
                        }}
                      />
                    </>
                  ) : (
                    <div className="py-10 text-center space-y-2 text-sm">
                      <p className="font-medium">No readable book file attached</p>
                      <p className="text-xs opacity-70">
                        AI translation is available whenever a PDF or EPUB book file is attached.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {settingsTab === "audio" && (
                <div className="mx-auto max-w-2xl">
                  <AudioSettingsPanel
                    bookId={book.id}
                    hasReadableFile={(fileType === "pdf" || fileType === "epub") && !!book.book_url}
                    isPreparingBookText={reflow.status === "extracting" || epubExtracting}
                    preparingProgress={reflow.progress}
                    isPreparingTranslation={isPreparingTranslationForAudio}
                    hasTextReady={!!activeReflowBook && activeReflowBook.blocks.length > 0}
                    displayPage={displayPage}
                    sourceLanguage={sourceLanguage}
                    targetLanguage={targetLanguage}
                    hasTranslatedText={Object.keys(translatedMap).length > 0}
                    hasChosenTranslationLanguage={hasChosenTranslationLanguage}
                    listenInTranslated={listenInTranslated}
                    onChangeListenInTranslated={setListenInTranslated}
                    savedListenProgress={savedListenProgress}
                    selectedExcerptText={selectedBookText}
                    onStartSelectionAudio={(text, useTr) => void handleSelectionAudio(text, useTr)}
                    onStartChoice={(mode) => void handleStartAudioFromChoice(mode)}
                    onSelectVoiceAndStart={(voiceId) => void handleSelectAndStartVoice(voiceId)}
                    onSyncPageToAudio={() => {
                      const seg = audiobook.activeSegment;
                      if (!seg) return;
                      if (seg.language === targetLanguage && translationReadingMode === "original") {
                        setTranslationReadingMode("translated");
                      }
                      jumpToBlock(seg.blockIndex);
                      closeSettingsOverlay();
                    }}
                    onOpenTranslationTab={() => handleSelectSettingsTab("translation")}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Table of Contents Sidebar */}
      {showToc && (
        <div
          className={cn(
            "fixed z-50 shadow-lg animate-in",
            isMobile
              ? "left-2 right-2 rounded-2xl border slide-in-from-bottom-4"
              : "top-0 left-0 bottom-0 w-72 border-r slide-in-from-left"
          )}
          style={{
            backgroundColor: activeThemePalette.chromeBg,
            color: activeThemePalette.text,
            borderColor: activeThemePalette.border,
            ...(isMobile
              ? {
                  bottom: MOBILE_PANEL_BOTTOM_OFFSET,
                  maxHeight: MOBILE_PANEL_MAX_HEIGHT,
                  display: "flex",
                  flexDirection: "column",
                }
              : {}),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b shrink-0" style={{ borderColor: activeThemePalette.border }}>
            <h2 className="font-semibold">Table of Contents</h2>
            <Button variant="ghost" size="icon" aria-label="Close Table of Contents" onClick={() => setShowToc(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <ScrollArea className={isMobile ? "flex-1 min-h-0" : "h-[calc(100%-60px)]"}>
            <div className="p-2">
              {isReaderMode && reflow.book && reflow.book.chapters.length > 0 ? (
                reflow.book.chapters.map((chapter) => {
                  const isActive = readerPagination.chapterTitle === chapter.title;
                  return (
                    <Button
                      key={chapter.id}
                      variant={isActive ? "secondary" : "ghost"}
                      className={cn("w-full justify-start text-left", isActive && "font-semibold")}
                      style={{ paddingLeft: `${16 + chapter.level * 16}px` }}
                      onClick={() => {
                        jumpToBlock(chapter.blockIndex);
                        setCurrentPage(chapter.page);
                        setShowToc(false);
                      }}
                    >
                      <span className="truncate">{chapter.title}</span>
                      <span className="ml-auto text-xs opacity-70">p.{chapter.page}</span>
                    </Button>
                  );
                })
              ) : fileType === "epub" && epubToc.length > 0 ? (
                renderEpubTocItems(epubToc)
              ) : pdfOutline.length > 0 ? (
                renderOutlineItems(pdfOutline)
              ) : (
                <>
                  <Button variant="ghost" className="w-full justify-start" onClick={() => { goToPage(1); setShowToc(false); }}>
                    <FileText className="w-4 h-4 mr-2" /> Start (Page 1)
                  </Button>
                  {totalPages > 10 && (
                    <Button variant="ghost" className="w-full justify-start" onClick={() => { goToPage(Math.floor(totalPages * 0.25)); setShowToc(false); }}>
                      <FileText className="w-4 h-4 mr-2" /> 25% (Page {Math.floor(totalPages * 0.25)})
                    </Button>
                  )}
                  {totalPages > 5 && (
                    <Button variant="ghost" className="w-full justify-start" onClick={() => { goToPage(Math.floor(totalPages * 0.5)); setShowToc(false); }}>
                      <FileText className="w-4 h-4 mr-2" /> Middle (Page {Math.floor(totalPages * 0.5)})
                    </Button>
                  )}
                  <Button variant="ghost" className="w-full justify-start" onClick={() => { goToPage(totalPages); setShowToc(false); }}>
                    <FileText className="w-4 h-4 mr-2" /> End (Page {totalPages})
                  </Button>
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Bookmarks Sidebar */}
      {showBookmarks && (
        <>
          {isMobile && (
            <div
              className="fixed inset-0 z-40 bg-black/40 animate-in fade-in-0"
              onClick={() => setShowBookmarks(false)}
            />
          )}
        <div
          className={cn(
            "fixed z-50 shadow-lg flex flex-col",
            isMobile
              ? "left-2 right-2 rounded-2xl border animate-in slide-in-from-bottom-4"
              : "top-0 right-0 bottom-0 w-72 border-l"
          )}
          style={{
            backgroundColor: activeThemePalette.chromeBg,
            color: activeThemePalette.text,
            borderColor: activeThemePalette.border,
            ...(isMobile
              ? {
                  bottom: MOBILE_PANEL_BOTTOM_OFFSET,
                  maxHeight: MOBILE_PANEL_MAX_HEIGHT,
                }
              : {}),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: activeThemePalette.border }}>
            <h2 className="font-semibold">Bookmarks ({bookmarks.length})</h2>
            <Button variant="ghost" size="icon" aria-label="Close Bookmarks" onClick={() => setShowBookmarks(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <ScrollArea className={isMobile ? "flex-1 min-h-0" : "h-[calc(100%-60px)]"}>
            <div className="p-2 space-y-1">
              {bookmarks.length === 0 ? (
                <p className="text-center opacity-70 text-sm py-8">
                  No bookmarks yet. Tap the bookmark icon to add one.
                </p>
              ) : (
                bookmarks.map((bm) => (
                  <div key={bm.id} className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      className="flex-1 justify-start text-left"
                      onClick={() => {
                        if (bm.location?.page) {
                          goToPage(bm.location.page);
                        } else if (bm.location?.cfi) {
                          epubGoToCfi(bm.location.cfi);
                        }
                        setShowBookmarks(false);
                      }}
                    >
                      <BookmarkCheck className="w-4 h-4 mr-2 text-yellow-500" />
                      <span className="truncate">{bm.label || `Page ${bm.location?.page || '?'}`}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove bookmark"
                      className="shrink-0 text-destructive hover:text-destructive"
                      onClick={() => removeBookmark.mutate(bm.id)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))
              )}

              {/* Highlights & notes (Reader Mode) */}
              {isReaderMode && highlights.length > 0 && (
                <div className="pt-3">
                  <Separator className="mb-2" />
                  <p className="px-2 pb-1 text-xs font-medium opacity-70">
                    Highlights &amp; notes ({highlights.length})
                  </p>
                  {highlights.map((highlight) => {
                    const index = reflow.book?.blocks.findIndex((b) => b.id === highlight.blockId) ?? -1;
                    return (
                      <div key={highlight.id} className="flex items-start gap-2">
                        <button
                          type="button"
                          className="flex-1 rounded-md px-2 py-2 text-left hover:bg-muted/50"
                          onClick={() => {
                            if (index >= 0) jumpToBlock(index);
                            setShowBookmarks(false);
                          }}
                        >
                          <span
                            className="line-clamp-2 text-sm"
                            style={{ backgroundColor: highlight.color }}
                          >
                            {highlight.text}
                          </span>
                          {highlight.note && (
                            <span className="mt-1 block text-xs italic opacity-75">
                              {highlight.note}
                            </span>
                          )}
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-destructive hover:text-destructive"
                          aria-label="Delete highlight"
                          onClick={() => removeHighlight(highlight.id)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
        </>
      )}

      {/* Search (Reader Mode) */}
      {showSearch && isReaderMode && reflow.book && (
        <>
          {isMobile && (
            <div
              className="fixed inset-0 z-40 bg-black/40 animate-in fade-in-0"
              onClick={() => setShowSearch(false)}
            />
          )}
          <div
            className={cn(
              "fixed z-50 flex flex-col shadow-lg",
              isMobile
                ? "left-2 right-2 rounded-2xl border animate-in slide-in-from-bottom-4"
                : "top-0 right-0 bottom-0 w-80 border-l"
            )}
            style={{
              backgroundColor: activeThemePalette.chromeBg,
              color: activeThemePalette.text,
              borderColor: activeThemePalette.border,
              ...(isMobile
                ? { bottom: MOBILE_PANEL_BOTTOM_OFFSET, maxHeight: MOBILE_PANEL_MAX_HEIGHT }
                : {}),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <ReaderSearchPanel
              book={reflow.book}
              query={searchQuery}
              onQueryChange={setSearchQuery}
              onSelect={(match) => {
                jumpToBlock(match.blockIndex);
                setCurrentPage(match.page);
                if (isMobile) setShowSearch(false);
              }}
              onClose={() => {
                setShowSearch(false);
                setSearchQuery("");
              }}
            />
          </div>
        </>
      )}


      {/* Main Content — true edge-to-edge. Always fills 100vh minus
          (header when shown) and (footer when shown). Ads NEVER displace it. */}
      <main
        className={cn(
          "absolute inset-x-0 overflow-hidden transition-[top,bottom] duration-300",
          showControls ? "top-14" : "top-0",
          showControls
            ? showNativeReaderAd
              ? "bottom-[15rem] sm:bottom-[14rem]"
              : "bottom-24 sm:bottom-20"
            : showNativeReaderAd
              ? "bottom-[10rem]"
              : "bottom-0"
        )}
      >
        <div className="relative w-full h-full overflow-hidden flex flex-col" style={{ backgroundColor: activeThemePalette.bg }}>
          {/* Reader Mode — reflowable text extracted from the PDF, plus Translated / Bilingual modes. */}
          {((isReaderMode || translationReadingMode !== "original") && book.book_url) && (
            <>
              {!reflowNoticeDismissed && showControls && activeReflowBook && activeReflowBook.blocks.length > 0 && (
                <div className="shrink-0 flex justify-center pt-1.5 pb-1 px-3 z-20" onClick={(e) => e.stopPropagation()}>
                  <div
                    className="flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] shadow-sm backdrop-blur-sm max-w-[92vw]"
                    style={{
                      backgroundColor: activeThemePalette.chromeBg,
                      borderColor: activeThemePalette.border,
                      color: activeThemePalette.text,
                    }}
                  >
                    <span className="truncate opacity-80">
                      {translationReadingMode !== "original"
                        ? `Translation Active · ${getLanguageMeta(targetLanguage).name}`
                        : activeReflowBook.meta.ocrPages || activeReflowBook.meta.rasterizedPages
                          ? `Adaptive Flow · ${
                              activeReflowBook.meta.ocrPages
                                ? `${activeReflowBook.meta.ocrPages} OCR page${activeReflowBook.meta.ocrPages > 1 ? "s" : ""}`
                                : ""
                            }${
                              activeReflowBook.meta.ocrPages && activeReflowBook.meta.rasterizedPages
                                ? " · "
                                : ""
                            }${
                              activeReflowBook.meta.rasterizedPages
                                ? `${activeReflowBook.meta.rasterizedPages} image page${activeReflowBook.meta.rasterizedPages > 1 ? "s" : ""}`
                                : ""
                            }`
                          : "Adaptive Flow · Layouts may vary"}
                    </span>
                    {translationReadingMode !== "original" ? (
                      <button
                        type="button"
                        className="font-semibold underline shrink-0"
                        onClick={() => setTranslationReadingMode("original")}
                      >
                        Original
                      </button>
                    ) : fileType === "pdf" ? (
                      <button
                        type="button"
                        className="font-semibold underline shrink-0"
                        onClick={() => {
                          setTranslationReadingMode("original");
                          setViewMode("original");
                        }}
                      >
                        Original PDF
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label="Dismiss reflow notice"
                      className="opacity-65 hover:opacity-100 shrink-0"
                      onClick={() => setReflowNoticeDismissed(true)}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}

              <div className="relative flex-1 min-h-0 w-full">
                {(translationReadingMode === "side_by_side" ||
                  translationReadingMode === "paragraph_by_paragraph") &&
                activeReflowBook &&
                activeReflowBook.blocks.length > 0 ? (
                  <BilingualReaderView
                    book={activeReflowBook}
                    chapters={activeChapters}
                    translatedMap={translatedMap}
                    sourceLanguage={sourceLanguage}
                    targetLanguage={targetLanguage}
                    mode={translationReadingMode}
                    settings={readerSettings}
                    activeSpeech={
                      audiobook.session?.bookId === book.id && audiobook.activeSegment
                        ? {
                            blockId: audiobook.activeSegment.blockId,
                            sentenceIndex: audiobook.activeSegment.sentenceIndex,
                            language: audiobook.activeSegment.language,
                            status: audiobook.status === "idle" ? undefined : audiobook.status,
                          }
                        : null
                    }
                    translatingIds={inlineTranslatingIds}
                    onSentenceClick={(bId, sIdx, isTranslatedCol) =>
                      void handleSentencePlayRequest(bId, sIdx, isTranslatedCol)
                    }
                    onParagraphAudioClick={(bId, useTranslated) =>
                      void handleParagraphAudio(bId, useTranslated)
                    }
                    onParagraphTranslateClick={(bId) => void handleParagraphTranslate(bId)}
                    onTranslateChapterAtBlock={(globalBlockIdx) => {
                      let targetChapIdx = 0;
                      for (let i = 0; i < activeChapters.length; i++) {
                        if (activeChapters[i].blockIndex <= globalBlockIdx) targetChapIdx = i;
                      }
                      void handleTranslateSingleChapter(targetChapIdx);
                    }}
                    onTap={toggleControls}
                  />
                ) : (isReaderMode || translationReadingMode === "translated") &&
                  translatedReflowBook &&
                  translatedReflowBook.blocks.length > 0 ? (
                  <PaginatedReader
                    book={translatedReflowBook}
                    settings={readerSettings}
                    highlights={highlights}
                    searchQuery={showSearch ? searchQuery : undefined}
                    jumpTo={jumpTo}
                    navRequest={navRequest}
                    activeSpeech={
                      audiobook.session?.bookId === book.id && audiobook.activeSegment
                        ? {
                            blockId: audiobook.activeSegment.blockId,
                            sentenceIndex: audiobook.activeSegment.sentenceIndex,
                            charStart: audiobook.activeSegment.charStart,
                            charEnd: audiobook.activeSegment.charEnd,
                            status: audiobook.status === "idle" ? undefined : audiobook.status,
                            isTranslatedSpeech:
                              audiobook.activeSegment.language !== sourceLanguage &&
                              translationReadingMode === "original",
                          }
                        : null
                    }
                    onSentenceClick={(bId, sIdx) => void handleSentencePlayRequest(bId, sIdx)}
                    onParagraphAudioClick={(bId) => void handleParagraphAudio(bId)}
                    onParagraphTranslateClick={(bId) => void handleParagraphTranslate(bId)}
                    onCloseInlineTranslation={handleCloseInlineTranslation}
                    onSelectionChangeText={setSelectedBookText}
                    onSelectionAudio={(text, isTr, langOv) => void handleSelectionAudio(text, isTr, langOv)}
                    onSelectionTranslate={handleSelectionTranslate}
                    inlineTranslations={
                      translationReadingMode === "translated" ? originalBlockTextMap : translatedMap
                    }
                    inlineTranslationVisible={inlineTranslationVisible}
                    inlineTranslatingIds={inlineTranslatingIds}
                    inlineTranslateErrors={inlineTranslateErrors}
                    inlineTranslationMeta={
                      translationReadingMode === "translated"
                        ? {
                            languageName: getLanguageMeta(sourceLanguage).name,
                            nativeName: "Original",
                            dir: activeReflowBook?.meta.dir ?? "ltr",
                          }
                        : {
                            languageName: getLanguageMeta(targetLanguage).name,
                            nativeName: getLanguageMeta(targetLanguage).nativeName,
                            dir: getLanguageMeta(targetLanguage).dir,
                          }
                    }
                    coverUrl={book.cover_url}
                    title={book.title}
                    author={book.author ?? undefined}
                    onLocationChange={handleReaderLocation}
                    onPaginationChange={setReaderPagination}
                    onCreateHighlight={handleCreateHighlight}
                    onTap={toggleControls}
                  />
                ) : reflow.status === "error" && fileType === "pdf" ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <Book className="h-10 w-10 opacity-60" />
                    <p className="text-sm opacity-75">{reflow.error}</p>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => reflow.reprocess()}>Try again</Button>
                      <Button onClick={() => {
                        setTranslationReadingMode("original");
                        setViewMode("original");
                      }}>Open original PDF</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                    <p className="text-sm opacity-75">
                      {epubExtracting ? "Extracting EPUB chapters…" : "Preparing Reader Mode…"}
                    </p>
                  </div>
                )}
              </div>

              {/* Background extraction indicator — reading is never blocked. */}
              {reflow.status === "extracting" && reflow.book && reflow.book.blocks.length > 0 && (
                <div className="pointer-events-none absolute right-3 top-3 z-30 flex items-center gap-2 rounded-full bg-black/65 px-3 py-1.5 text-[11px] font-medium text-white">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Preparing {reflow.progress}%
                </div>
              )}
            </>
          )}

          {/* Original PDF Viewer — wrapper paints theme bg behind canvas */}
          {fileType === "pdf" && !isReaderMode && translationReadingMode === "original" && book.book_url && (
            <div
              className="w-full h-full overflow-auto overscroll-contain"
              style={{
                backgroundColor: activeThemePalette.bg,
                WebkitOverflowScrolling: "touch",
                touchAction: "pan-y pinch-zoom",
              }}
            >
              <PDFViewer
                key={`${book.id}-${book.book_url}`}
                url={book.book_url}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                onTotalPagesChange={handleTotalPagesChange}
                onOutlineExtracted={handleOutlineExtracted}
                onTap={toggleControls}
                onScaleChange={setScale}
                fitMode={pdfFitMode}
                readerTheme={readerSettings.theme}
                brightness={readerSettings.brightness}
                warmth={readerSettings.warmth}
                isDarkMode={isDarkReaderTheme(readerSettings.theme)}
                scale={scale}
                className="max-w-full"
              />
            </div>
          )}

          {/* EPUB Viewer (original EPUB mode) */}
          {fileType === "epub" && translationReadingMode === "original" && book.book_url && (
            <div
              ref={epubRef}
              className="w-full h-full block [&>div]:!h-full [&>div]:!min-h-[unset] [&_iframe]:!h-full"
              style={{ backgroundColor: activeThemePalette.bg }}
            >
              <EPUBViewer
                url={book.book_url}
                initialCfi={epubCfi}
                onLocationChange={handleEpubLocationChange}
                onTocExtracted={handleEpubTocExtracted}
                onParagraphAudio={(text) => void handleEpubParagraphAudio(text)}
                onParagraphTranslate={handleEpubParagraphTranslate}
                onTap={toggleControls}
                settings={readerSettings}
                className="!h-full !min-h-0 w-full"
              />
            </div>
          )}

          {/* No file fallback */}
          {(fileType === "unknown" || !book.book_url) && (
            <div className="w-full h-full flex items-center justify-center p-4">
              <Card
                className="p-8 sm:p-12 max-w-2xl w-full"
                style={{
                  backgroundColor: activeThemePalette.chromeBg,
                  color: activeThemePalette.text,
                  borderColor: activeThemePalette.border,
                }}
              >
                <div className="prose max-w-none dark:prose-invert">
                  <h2 className="text-center mb-8">{book.title}</h2>
                  <div className="flex flex-col items-center justify-center gap-4 py-8">
                    <Book className="w-16 h-16 opacity-60" />
                    <p className="text-center opacity-75">
                      {book.description || "This book doesn't have a readable file attached."}
                    </p>
                    <p className="text-sm opacity-70">
                      Please upload a PDF or EPUB file to enable reading.
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* Inline highlight note dialog (avoids browser window.prompt) */}
          {noteDraft && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
              onClick={(e) => {
                e.stopPropagation();
                removeHighlight(noteDraft.highlightId);
                setNoteDraft(null);
              }}
            >
              <Card
                className="w-full max-w-sm p-4 space-y-3"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Add Reading Note</h3>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Cancel note"
                    onClick={() => {
                      removeHighlight(noteDraft.highlightId);
                      setNoteDraft(null);
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 italic border-l-2 pl-2">
                  "{noteDraft.text}"
                </p>
                <Input
                  autoFocus
                  placeholder="Write your note..."
                  value={noteDraft.value}
                  onChange={(e) => setNoteDraft({ ...noteDraft, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (noteDraft.value.trim()) {
                        updateHighlight(noteDraft.highlightId, { note: noteDraft.value.trim() });
                      } else {
                        removeHighlight(noteDraft.highlightId);
                      }
                      setNoteDraft(null);
                    }
                  }}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      removeHighlight(noteDraft.highlightId);
                      setNoteDraft(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (noteDraft.value.trim()) {
                        updateHighlight(noteDraft.highlightId, { note: noteDraft.value.trim() });
                      } else {
                        removeHighlight(noteDraft.highlightId);
                      }
                      setNoteDraft(null);
                    }}
                  >
                    Save Note
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {/* Edge tap zones for mobile/tablet on Original EPUB (center stays clear for paragraph buttons & text) */}
          {fileType === "epub" && translationReadingMode === "original" && (
            <div className="absolute inset-0 z-30 md:hidden flex justify-between pointer-events-none">
              <button
                type="button"
                aria-label="Previous page"
                className="h-full w-[14%] pointer-events-auto bg-transparent"
                style={{ touchAction: "pan-y" }}
                onClick={(e) => {
                  e.stopPropagation();
                  epubPrev();
                }}
              />
              <button
                type="button"
                aria-label="Next page"
                className="h-full w-[14%] pointer-events-auto bg-transparent"
                style={{ touchAction: "pan-y" }}
                onClick={(e) => {
                  e.stopPropagation();
                  epubNext();
                }}
              />
            </div>
          )}

          {/* Floating inline reader ad */}
          {!nativeReaderAdsEnabled && showReaderAd && (
            <div
              className="absolute bottom-2 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-2 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <BookReaderInlineAd
                key={`reader-ad-${adKey}`}
                variant={isChapterEndAdPage ? "chapter_end" : "inline"}
                theme={legacyAdTheme}
                onDismiss={() => setAdDismissedFor(currentPage)}
              />
            </div>
          )}
        </div>
      </main>

      {showNativeReaderAd && (
        <div
          className="fixed inset-x-0 z-40 border-t px-3 py-3"
          style={{
            bottom: showControls ? "calc(96px + env(safe-area-inset-bottom, 0px))" : "env(safe-area-inset-bottom, 0px)",
            backgroundColor: activeThemePalette.chromeBg,
            borderColor: activeThemePalette.border,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mx-auto w-full max-w-md">
            <NativeAdSlot
              placement="BS_READER_01"
              slotKey={`reader-${book.id}-page-${displayPage}`}
              height={120}
              onStateChange={(state) => {
                if (state === "failed") setNativeAdPage(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Integrated Audiobook Dock */}
      <AudiobookPlayer
        chromeBg={activeThemePalette.chromeBg}
        textColor={activeThemePalette.text}
        borderColor={activeThemePalette.border}
        isMobile={isMobile}
        onSyncTextToAudio={() => {
          const seg = audiobook.activeSegment;
          if (!seg) return;
          if (seg.language === targetLanguage && translationReadingMode === "original") {
            setTranslationReadingMode("translated");
          }
          jumpToBlock(seg.blockIndex);
        }}
      />

      {/* Bottom Navigation */}
      <footer
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300 backdrop-blur-sm border-t",
          showControls && !(audiobook.session?.bookId === book.id && audiobook.isDrawerOpen && !audiobook.isMinimized)
            ? "translate-y-0"
            : "translate-y-full"
        )}
        onClick={(e) => e.stopPropagation()}
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          backgroundColor: activeThemePalette.chromeBg,
          borderColor: activeThemePalette.border,
          color: activeThemePalette.text,
        }}
      >
        {/* Sponsored sticky banner above pagination — height-constrained
            so footer stays a predictable ~96px mobile / ~80px desktop. */}
        {!nativeReaderAdsEnabled && (
          <div className="max-h-[50px] overflow-hidden">
            <StickyBannerAd placement="bookshelf_reader_sticky" />
          </div>
        )}
        <div className="px-4 py-2 sm:py-1.5">
          {/* Progress Bar */}
          <div className="mb-2">
            <Slider
              value={[displayPage]}
              onValueChange={(v) => {
                if (isReaderMode) {
                  const total = Math.max(displayTotal, 1);
                  const blocks = reflow.book?.blocks.length ?? 0;
                  if (blocks > 0) {
                    const ratio = Math.min(Math.max((v[0] - 1) / total, 0), 0.999);
                    jumpToBlock(Math.floor(ratio * blocks));
                  }
                } else {
                  setCurrentPage(v[0]);
                }
              }}
              min={1}
              max={Math.max(displayTotal, 1)}
              step={1}
            />
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (isReaderMode) requestFlip(-1);
                else if (fileType === "epub") epubPrev();
                else goToPage(currentPage - 1);
              }}
              disabled={!isReaderMode && fileType !== "epub" && currentPage <= 1}
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Prev
            </Button>

            <span className="flex flex-col items-center text-sm font-medium leading-tight">
              <span>
                {displayPage} / {Math.max(displayTotal, 1)} · {displayPercent}%
              </span>
              {isReaderMode && readerPagination.chapterTitle && (
                <span className="max-w-[46vw] truncate text-[11px] font-normal opacity-70">
                  {readerPagination.chapterTitle}
                </span>
              )}
            </span>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (isReaderMode) requestFlip(1);
                else if (fileType === "epub") epubNext();
                else goToPage(currentPage + 1);
              }}
              disabled={!isReaderMode && fileType !== "epub" && currentPage >= totalPages}
            >
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default BookReader;
