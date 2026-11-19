import { useEffect, useMemo, useRef } from "react";
import { Languages, Loader2, Pause, Sparkles, Volume2 } from "lucide-react";
import type { Block, Chapter, Direction, ReflowBook } from "@/lib/reader/types";
import {
  READER_FONT_STACKS,
  READER_THEMES,
  type ReaderSettings,
} from "@/lib/reader/settings";
import { getLanguageMeta } from "@/lib/ai/languages";
import { splitIntoSentences } from "@/lib/ai/segments";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BilingualReaderViewProps {
  book: ReflowBook;
  chapters: Chapter[];
  translatedMap: Record<string, string>;
  sourceLanguage: string;
  targetLanguage: string;
  mode: "side_by_side" | "paragraph_by_paragraph";
  settings: ReaderSettings;
  activeSpeech?: {
    blockId: string;
    sentenceIndex: number;
    language: string;
    status?: "loading" | "playing" | "paused" | "error";
  } | null;
  translatingIds?: Record<string, boolean>;
  onSentenceClick?: (blockId: string, sentenceIndex: number, isTranslatedSide: boolean) => void;
  onParagraphAudioClick?: (blockId: string, useTranslated?: boolean) => void;
  onParagraphTranslateClick?: (blockId: string) => void;
  onTranslateChapterAtBlock?: (blockIndex: number) => void;
  onTap?: () => void;
}

function renderSentences(params: {
  text: string;
  blockId: string;
  isTranslatedSide: boolean;
  activeSpeech?: { blockId: string; sentenceIndex: number; language: string } | null;
  speechMatchesThisColumn: boolean;
  accentColor: string;
  onClickSentence?: (blockId: string, sentenceIndex: number, isTranslatedSide: boolean) => void;
}) {
  const { text, blockId, isTranslatedSide, activeSpeech, speechMatchesThisColumn, accentColor, onClickSentence } = params;
  if (speechMatchesThisColumn && activeSpeech?.blockId === blockId && activeSpeech.sentenceIndex === -1) {
    return (
      <span
        data-active-speech="true"
        onClick={(e) => {
          if (!onClickSentence) return;
          e.stopPropagation();
          onClickSentence(blockId, 0, isTranslatedSide);
        }}
        className={cn(onClickSentence && "cursor-pointer hover:underline decoration-dotted")}
        style={{
          backgroundColor: `${accentColor}26`,
          borderRadius: 4,
          padding: "1px 3px",
        }}
      >
        {text}
      </span>
    );
  }

  const sentences = splitIntoSentences(text);
  if (sentences.length <= 1) {
    const isActive = speechMatchesThisColumn && activeSpeech?.blockId === blockId && activeSpeech.sentenceIndex === 0;
    return (
      <span
        data-active-speech={isActive ? "true" : undefined}
        onClick={(e) => {
          if (!onClickSentence) return;
          e.stopPropagation();
          onClickSentence(blockId, 0, isTranslatedSide);
        }}
        className={cn(onClickSentence && "cursor-pointer hover:underline decoration-dotted")}
        style={
          isActive
            ? {
                backgroundColor: `${accentColor}26`,
                borderRadius: 4,
                padding: "1px 3px",
              }
            : undefined
        }
      >
        {text}
      </span>
    );
  }

  return sentences.map((s) => {
    const isActive =
      speechMatchesThisColumn &&
      activeSpeech?.blockId === blockId &&
      activeSpeech.sentenceIndex === s.index;
    return (
      <span
        key={s.index}
        data-active-speech={isActive ? "true" : undefined}
        onClick={(e) => {
          if (!onClickSentence) return;
          e.stopPropagation();
          onClickSentence(blockId, s.index, isTranslatedSide);
        }}
        className={cn(onClickSentence && "cursor-pointer hover:underline decoration-dotted", "mr-1")}
        style={
          isActive
            ? {
                backgroundColor: `${accentColor}26`,
                borderRadius: 4,
                padding: "1px 3px",
              }
            : undefined
        }
      >
        {s.text}
      </span>
    );
  });
}

export default function BilingualReaderView({
  book,
  translatedMap,
  sourceLanguage,
  targetLanguage,
  mode,
  settings,
  activeSpeech,
  translatingIds,
  onSentenceClick,
  onParagraphAudioClick,
  onParagraphTranslateClick,
  onTranslateChapterAtBlock,
  onTap,
}: BilingualReaderViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = READER_THEMES[settings.theme] ?? READER_THEMES.light;
  const srcMeta = getLanguageMeta(sourceLanguage);
  const tgtMeta = getLanguageMeta(targetLanguage);
  const fontStack = READER_FONT_STACKS[settings.font] ?? READER_FONT_STACKS.serif;

  const textBlocks = useMemo(
    () =>
      book.blocks
        .map((block, globalIndex) => ({ block, globalIndex }))
        .filter(
          (item): item is { block: Extract<Block, { type: "heading" | "paragraph" }>; globalIndex: number } =>
            item.block.type === "heading" || item.block.type === "paragraph",
        ),
    [book.blocks],
  );

  // Smoothly scroll active spoken sentence into view
  useEffect(() => {
    if (!activeSpeech?.blockId) return;
    const container = containerRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>('[data-active-speech="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeSpeech?.blockId, activeSpeech?.sentenceIndex]);

  const speechOnTranslated = activeSpeech?.language === tgtMeta.code;
  const speechOnOriginal = activeSpeech?.language === srcMeta.code || !speechOnTranslated;

  const renderBlockActionIcons = (blockId: string, translatedReady: boolean) => {
    const isAudioBlock = activeSpeech?.blockId === blockId;
    const isLoadingAudio = isAudioBlock && activeSpeech?.status === "loading";
    const isPlayingAudio = isAudioBlock && activeSpeech?.status === "playing";
    const isTranslatingBlock = Boolean(translatingIds?.[blockId]);

    return (
      <span
        data-reader-toolbar
        dir="ltr"
        className="float-end ms-2 inline-flex items-center gap-0.5 select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {onParagraphAudioClick && (
          <button
            type="button"
            aria-label={isPlayingAudio ? "Pause paragraph audio" : "Listen to paragraph"}
            title={isPlayingAudio ? "Pause audio" : "Listen to paragraph"}
            onClick={(e) => {
              e.stopPropagation();
              onParagraphAudioClick(blockId, translatedReady);
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:opacity-100"
            style={{
              color: isAudioBlock ? theme.accent : theme.muted,
              backgroundColor: isAudioBlock ? `${theme.accent}1f` : "transparent",
              opacity: isAudioBlock ? 1 : 0.72,
            }}
          >
            {isLoadingAudio ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isPlayingAudio ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Volume2 className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        {onParagraphTranslateClick && (
          <button
            type="button"
            aria-label={isTranslatingBlock ? "Translating paragraph" : "Translate paragraph"}
            title={translatedReady ? "Retranslate or view paragraph" : "Translate this paragraph"}
            onClick={(e) => {
              e.stopPropagation();
              onParagraphTranslateClick(blockId);
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:opacity-100"
            style={{
              color: translatedReady || isTranslatingBlock ? theme.accent : theme.muted,
              backgroundColor:
                translatedReady || isTranslatingBlock ? `${theme.accent}1f` : "transparent",
              opacity: translatedReady || isTranslatingBlock ? 1 : 0.72,
            }}
          >
            {isTranslatingBlock ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Languages className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </span>
    );
  };

  return (
    <div
      ref={containerRef}
      onClick={(e) => {
        e.stopPropagation();
        onTap?.();
      }}
      className="h-full w-full overflow-y-auto px-3 sm:px-6 py-5 select-text"
      style={{
        backgroundColor: theme.bg,
        color: theme.text,
        fontFamily: fontStack,
      }}
    >
      <div className="max-w-5xl mx-auto space-y-4 pb-24">
        {/* Column Headers */}
        <div
          className={cn(
            "pb-2.5 border-b text-xs font-semibold uppercase tracking-wider opacity-75 flex items-center justify-between gap-4",
          )}
          style={{ borderColor: theme.border }}
        >
          <span>Original · {srcMeta.name}</span>
          <span className="flex items-center gap-1.5">
            <Languages className="w-3.5 h-3.5" />
            Translated · {tgtMeta.name} ({tgtMeta.nativeName})
          </span>
        </div>

        {textBlocks.map(({ block, globalIndex }) => {
          const translated = translatedMap[block.id];
          const isHeading = block.type === "heading";
          const srcDir: Direction = block.dir || srcMeta.dir;
          const tgtDir: Direction = tgtMeta.dir;

          if (mode === "side_by_side") {
            return (
              <div
                key={block.id}
                data-block-id={block.id}
                className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6 pb-4 border-b"
                style={{ borderColor: `${theme.border}99` }}
              >
                <div
                  dir={srcDir}
                  className={cn(isHeading ? "font-bold text-lg sm:text-xl" : "")}
                  style={{
                    fontSize: isHeading ? undefined : `${settings.fontSize}px`,
                    lineHeight: settings.lineHeight,
                  }}
                >
                  {renderBlockActionIcons(block.id, Boolean(translated))}
                  {renderSentences({
                    text: block.text,
                    blockId: block.id,
                    isTranslatedSide: false,
                    activeSpeech,
                    speechMatchesThisColumn: speechOnOriginal,
                    accentColor: theme.accent,
                    onClickSentence: onSentenceClick,
                  })}
                </div>

                <div
                  dir={tgtDir}
                  className={cn(
                    isHeading ? "font-bold text-lg sm:text-xl" : "",
                    !translated && "opacity-75 flex items-center justify-between gap-2 text-xs",
                  )}
                  style={{
                    fontSize: !translated || isHeading ? undefined : `${settings.fontSize}px`,
                    lineHeight: settings.lineHeight,
                  }}
                >
                  {translated ? (
                    renderSentences({
                      text: translated,
                      blockId: block.id,
                      isTranslatedSide: true,
                      activeSpeech,
                      speechMatchesThisColumn: speechOnTranslated,
                      accentColor: theme.accent,
                      onClickSentence: onSentenceClick,
                    })
                  ) : (
                    <>
                      <span>Not translated yet for this section.</span>
                      {onTranslateChapterAtBlock && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onTranslateChapterAtBlock(globalIndex);
                          }}
                          className="h-7 px-2 text-xs shrink-0"
                        >
                          <Sparkles className="w-3 h-3 mr-1" />
                          Translate Chapter
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          }

          // Paragraph-by-Paragraph mode
          return (
            <div
              key={block.id}
              data-block-id={block.id}
              className="space-y-2 pb-4 border-b"
              style={{ borderColor: `${theme.border}99` }}
            >
              <div
                dir={srcDir}
                className={cn(isHeading ? "font-bold text-lg sm:text-xl" : "opacity-80")}
                style={{
                  fontSize: isHeading ? undefined : `${Math.max(13, settings.fontSize - 1)}px`,
                  lineHeight: settings.lineHeight,
                }}
              >
                {renderBlockActionIcons(block.id, Boolean(translated))}
                {renderSentences({
                  text: block.text,
                  blockId: block.id,
                  isTranslatedSide: false,
                  activeSpeech,
                  speechMatchesThisColumn: speechOnOriginal,
                  accentColor: theme.accent,
                  onClickSentence: onSentenceClick,
                })}
              </div>

              {translated ? (
                <div
                  dir={tgtDir}
                  className={cn(isHeading ? "font-bold text-lg sm:text-xl" : "font-medium")}
                  style={{
                    fontSize: isHeading ? undefined : `${settings.fontSize}px`,
                    lineHeight: settings.lineHeight,
                  }}
                >
                  {renderSentences({
                    text: translated,
                    blockId: block.id,
                    isTranslatedSide: true,
                    activeSpeech,
                    speechMatchesThisColumn: speechOnTranslated,
                    accentColor: theme.accent,
                    onClickSentence: onSentenceClick,
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 text-xs opacity-70 pt-0.5">
                  <span>Pending translation for this paragraph</span>
                  {onTranslateChapterAtBlock && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTranslateChapterAtBlock(globalIndex);
                      }}
                      className="h-7 px-2 text-xs shrink-0"
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      Translate Chapter
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
