/**
 * PaginatedReader — Google Play Books style reflowable reader (Bookshelf only).
 *
 * Architecture (fixed):
 *   Document → one continuous DOM → viewport → visible "page"
 *
 * The book is NEVER split into sections/columns/pages. Every extracted block is
 * mounted exactly once inside a single continuous flowing document. A "page" is
 * simply a viewport position inside that document, so nothing can ever be
 * clipped, skipped or duplicated. Scrolling is fully continuous; tap zones and
 * external nav controls only move the viewport by one screen.
 *
 * Reflow is real semantic HTML reflow — no zoom, no transform scaling, no
 * canvas, no iframes. Changing typography relayouts the text and the reader
 * stays anchored to the exact same sentence.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Highlighter, StickyNote, Copy, X, Volume2, Pause, Languages, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Block, Highlight, ImageBlock, ReflowBook } from "@/lib/reader/types";
import { isHiddenMetadata, normalizeReaderText } from "@/lib/reader/sanitize";
import { isBoilerplate, isGarbageLine } from "@/lib/reader/quality";

import PagedFlow, { type PagedFlowHandle } from "@/components/bookshelf/reader/PagedFlow";

import {
  isDarkReaderTheme,
  READER_FONT_STACKS,
  READER_THEMES,
  type ReaderSettings,
} from "@/lib/reader/settings";


import { splitIntoSentences } from "@/lib/ai/segments";

export interface ReaderLocation {
  blockIndex: number;
  blockId: string;
  page: number;
  percent: number;
  snippet: string;
}

export interface PaginationInfo {
  page: number;
  totalPages: number;
  percent: number;
  chapterTitle: string;
}

export interface ActiveSpeechInfo {
  blockId: string;
  sentenceIndex: number;
  charStart?: number;
  charEnd?: number;
  status?: "loading" | "playing" | "paused" | "error";
  isTranslatedSpeech?: boolean;
}

interface Props {
  book: ReflowBook;
  settings: ReaderSettings;
  highlights: Highlight[];
  searchQuery?: string;
  jumpTo?: { blockIndex: number; token: number } | null;
  /** Imperative viewport flip request from external controls. */
  navRequest?: { delta: number; token: number } | null;
  activeSpeech?: ActiveSpeechInfo | null;
  onSentenceClick?: (blockId: string, sentenceIndex: number) => void;
  onParagraphAudioClick?: (blockId: string) => void;
  onParagraphTranslateClick?: (blockId: string) => void;
  onCloseInlineTranslation?: (blockId: string) => void;
  inlineTranslations?: Record<string, string>;
  inlineTranslationVisible?: Record<string, boolean>;
  inlineTranslatingIds?: Record<string, boolean>;
  inlineTranslateErrors?: Record<string, string>;
  inlineTranslationMeta?: {
    languageName: string;
    nativeName: string;
    dir: "ltr" | "rtl";
  };
  coverUrl?: string | null;
  title?: string;
  author?: string;
  onLocationChange?: (location: ReaderLocation) => void;
  onPaginationChange?: (info: PaginationInfo) => void;
  onCreateHighlight?: (payload: {
    blockId: string;
    start: number;
    end: number;
    text: string;
    withNote: boolean;
  }) => void;
  onTap?: () => void;
  className?: string;
}

const MARGIN_STEPS = [16, 26, 40, 60];
/** Stable empty array so blocks without highlights never break memoisation. */
const EMPTY_HIGHLIGHTS: Highlight[] = [];
const MAX_CONTENT_WIDTH = [760, 700, 640, 580];
/** Above this block count we let the browser skip offscreen painting. */
const VIRTUALIZE_THRESHOLD = 250;

/* ------------------------------- text pieces ------------------------------- */

interface TextRange {
  start: number;
  end: number;
  kind: "highlight" | "search" | "speech";
  color?: string;
  id?: string;
}

function segmentText(text: string, ranges: TextRange[]) {
  if (!ranges.length) return [{ text, range: null as TextRange | null }];
  const bounds = new Set<number>([0, text.length]);
  ranges.forEach((r) => {
    bounds.add(Math.max(0, Math.min(text.length, r.start)));
    bounds.add(Math.max(0, Math.min(text.length, r.end)));
  });
  const points = [...bounds].sort((a, b) => a - b);
  const out: { text: string; range: TextRange | null }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    const hit =
      ranges.find((r) => r.kind === "speech" && r.start <= start && r.end >= end) ??
      ranges.find((r) => r.kind === "search" && r.start <= start && r.end >= end) ??
      ranges.find((r) => r.start <= start && r.end >= end) ??
      null;
    out.push({ text: text.slice(start, end), range: hit });
  }
  return out;
}

function findSearchRanges(text: string, query: string): TextRange[] {
  if (!query || query.trim().length < 2) return [];
  const needle = query.trim().toLowerCase();
  const haystack = text.toLowerCase();
  const out: TextRange[] = [];
  let from = 0;
  while (out.length < 40) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    out.push({ start: index, end: index + needle.length, kind: "search" });
    from = index + needle.length;
  }
  return out;
}

const TextContent = ({
  text,
  ranges,
  accentColor,
}: {
  text: string;
  ranges: TextRange[];
  accentColor: string;
}) => (
  <>
    {segmentText(text, ranges).map((segment, index) =>
      segment.range ? (
        <mark
          key={index}
          data-highlight-id={segment.range.id}
          data-speech-active={segment.range.kind === "speech" ? "true" : undefined}
          style={{
            backgroundColor:
              segment.range.kind === "speech"
                ? `${accentColor}2e`
                : segment.range.kind === "search"
                  ? "rgba(255, 213, 79, 0.85)"
                  : segment.range.color || "rgba(255, 235, 59, 0.42)",
            color: "inherit",
            borderRadius: 3,
            padding: segment.range.kind === "speech" ? "1px 2px" : "0 1px",
          }}
        >
          {segment.text}
        </mark>
      ) : (
        <span key={index}>{segment.text}</span>
      )
    )}
  </>
);

/**
 * Inline illustration — stays attached to its surrounding paragraphs in the
 * flow, keeps its aspect ratio, never overlaps text, lazily decoded.
 */
const ImageContent = ({ block }: { block: ImageBlock }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(block.blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [block.blob]);

  const ratio = block.width > 0 && block.height > 0 ? block.width / block.height : undefined;

  return (
    <figure
      data-block-id={block.id}
      style={{ margin: "1.2em 0", textAlign: "center" }}
    >
      {src && (
        <img
          src={src}
          alt={block.alt || ""}
          decoding="async"
          loading="lazy"
          style={{
            display: "inline-block",
            maxWidth: "100%",
            maxHeight: "72vh",
            width: "auto",
            height: "auto",
            aspectRatio: ratio ? `${block.width} / ${block.height}` : undefined,
            objectFit: "contain",
            borderRadius: 6,
          }}
        />
      )}
    </figure>
  );
};

/* --------------------------------- blocks --------------------------------- */

const BlockView = memo(
  ({
    block,
    settings,
    highlights,
    searchQuery,
    activeSpeechForBlock,
    onSentenceDoubleClick,
    onParagraphAudioClick,
    onParagraphTranslateClick,
    onCloseInlineTranslation,
    inlineTranslatedText,
    isInlineTranslationVisible,
    isInlineTranslating,
    inlineTranslateError,
    inlineTranslationMeta,
  }: {
    block: Block;
    settings: ReaderSettings;
    highlights: Highlight[];
    searchQuery?: string;
    activeSpeechForBlock?: ActiveSpeechInfo | null;
    onSentenceDoubleClick?: (blockId: string, sentenceIndex: number) => void;
    onParagraphAudioClick?: (blockId: string) => void;
    onParagraphTranslateClick?: (blockId: string) => void;
    onCloseInlineTranslation?: (blockId: string) => void;
    inlineTranslatedText?: string;
    isInlineTranslationVisible?: boolean;
    isInlineTranslating?: boolean;
    inlineTranslateError?: string;
    inlineTranslationMeta?: {
      languageName: string;
      nativeName: string;
      dir: "ltr" | "rtl";
    };
  }) => {
    const theme = READER_THEMES[settings.theme];

    if (block.type === "pagebreak") {
      // A source page boundary is invisible in a reflowable document — it only
      // contributes a little breathing room. It never breaks the flow.
      return <div data-block-id={block.id} aria-hidden style={{ height: settings.fontSize * 0.4 }} />;
    }

    if (block.type === "image") {
      return <ImageContent block={block} />;
    }

    if (block.type === "table") {
      return (
        <div data-block-id={block.id} style={{ margin: "1em 0", overflowX: "auto" }}>
          <table
            style={{
              borderCollapse: "collapse",
              width: "100%",
              tableLayout: "fixed",
              fontSize: `${settings.fontSize * 0.84}px`,
              lineHeight: 1.4,
            }}
          >
            <tbody>
              {block.rows.map((row, rIndex) => (
                <tr key={rIndex}>
                  {row.map((cell, cIndex) => (
                    <td
                      key={cIndex}
                      style={{
                        border: `1px solid ${theme.muted}44`,
                        padding: "5px 8px",
                        verticalAlign: "top",
                        overflowWrap: "break-word",
                        fontWeight: rIndex === 0 ? 600 : 400,
                      }}
                    >
                      {normalizeReaderText(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    const text = block.text;
    const speakingInlineCard = Boolean(
      activeSpeechForBlock?.isTranslatedSpeech && isInlineTranslationVisible && inlineTranslatedText,
    );
    const computeSpeechRanges = (targetText: string): TextRange[] => {
      if (!activeSpeechForBlock) return [];
      if (
        typeof activeSpeechForBlock.charStart === "number" &&
        typeof activeSpeechForBlock.charEnd === "number" &&
        activeSpeechForBlock.charEnd > activeSpeechForBlock.charStart
      ) {
        return [
          {
            start: Math.max(0, activeSpeechForBlock.charStart),
            end: Math.min(targetText.length, activeSpeechForBlock.charEnd),
            kind: "speech",
          },
        ];
      }
      if (activeSpeechForBlock.sentenceIndex === -1) {
        return [{ start: 0, end: targetText.length, kind: "speech" }];
      }
      if (activeSpeechForBlock.sentenceIndex >= 0) {
        const spans = splitIntoSentences(targetText);
        const targetSpan = spans[activeSpeechForBlock.sentenceIndex] ?? spans[0];
        if (targetSpan) {
          return [{ start: targetSpan.start, end: targetSpan.end, kind: "speech" }];
        }
      }
      return [];
    };

    const speechRanges: TextRange[] = !activeSpeechForBlock
      ? []
      : speakingInlineCard
        ? []
        : activeSpeechForBlock.isTranslatedSpeech
          ? [{ start: 0, end: text.length, kind: "speech" }]
          : computeSpeechRanges(text);
    const inlineSpeechRanges: TextRange[] =
      speakingInlineCard && inlineTranslatedText ? computeSpeechRanges(inlineTranslatedText) : [];

    // `highlights` is already scoped to this block by the parent, so memoised
    // blocks no longer re-render when an unrelated highlight is added.
    const ranges: TextRange[] = [
      ...highlights.map<TextRange>((h) => ({
        start: h.start,
        end: h.end,
        kind: "highlight",
        color: h.color,
        id: h.id,
      })),
      ...findSearchRanges(text, searchQuery ?? ""),
      ...speechRanges,
    ];

    const handleDoubleClick = (e: React.MouseEvent<HTMLElement>) => {
      if (!onSentenceDoubleClick) return;
      const spans = splitIntoSentences(text);
      if (spans.length <= 1) {
        onSentenceDoubleClick(block.id, 0);
        return;
      }
      const docWithCaret = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      const range = docWithCaret.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (range) {
        const charOffset = offsetWithin(e.currentTarget, range.startContainer, range.startOffset);
        const found = spans.find((s) => charOffset >= s.start && charOffset <= s.end + 1);
        onSentenceDoubleClick(block.id, found ? found.index : 0);
      } else {
        onSentenceDoubleClick(block.id, 0);
      }
    };

    const isAudioActive = Boolean(activeSpeechForBlock);
    const isAudioLoading = isAudioActive && activeSpeechForBlock?.status === "loading";
    const isAudioPlaying = isAudioActive && activeSpeechForBlock?.status === "playing";
    const showBlockActions =
      Boolean(onParagraphAudioClick || onParagraphTranslateClick) && text.trim().length > 0;

    const actionButtons = showBlockActions ? (
      <span
        data-reader-toolbar
        dir="ltr"
        className="float-end ms-2 mt-0.5 inline-flex items-center gap-0.5 select-none"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {onParagraphAudioClick && (
          <button
            type="button"
            aria-label={
              isAudioPlaying
                ? "Pause paragraph audio"
                : isAudioLoading
                  ? "Loading paragraph audio"
                  : "Listen to paragraph"
            }
            aria-pressed={isAudioPlaying}
            title={
              isAudioPlaying
                ? "Pause audio"
                : isAudioLoading
                  ? "Generating audio..."
                  : "Listen to this paragraph"
            }
            onClick={(e) => {
              e.stopPropagation();
              onParagraphAudioClick(block.id);
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:opacity-100"
            style={{
              color: isAudioActive ? theme.accent : theme.muted,
              backgroundColor: isAudioActive ? `${theme.accent}1f` : "transparent",
              opacity: isAudioActive ? 1 : 0.72,
            }}
          >
            {isAudioLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isAudioPlaying ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Volume2 className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        {onParagraphTranslateClick && (
          <button
            type="button"
            aria-label={
              isInlineTranslationVisible
                ? "Hide paragraph translation"
                : isInlineTranslating
                  ? "Translating paragraph"
                  : "Translate paragraph"
            }
            aria-pressed={Boolean(isInlineTranslationVisible)}
            title={
              isInlineTranslationVisible
                ? "Hide translation"
                : isInlineTranslating
                  ? "Translating..."
                  : "Translate this paragraph"
            }
            onClick={(e) => {
              e.stopPropagation();
              onParagraphTranslateClick(block.id);
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:opacity-100"
            style={{
              color: isInlineTranslationVisible || isInlineTranslating ? theme.accent : theme.muted,
              backgroundColor:
                isInlineTranslationVisible || isInlineTranslating ? `${theme.accent}1f` : "transparent",
              opacity: isInlineTranslationVisible || isInlineTranslating ? 1 : 0.72,
            }}
          >
            {isInlineTranslating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Languages className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </span>
    ) : null;

    const inlineTranslationCard =
      (isInlineTranslationVisible && inlineTranslatedText) || inlineTranslateError ? (
        <div
          data-inline-translation={block.id}
          dir={inlineTranslateError ? "ltr" : inlineTranslationMeta?.dir || "ltr"}
          style={{
            marginTop: "0.45em",
            padding: "0.5em 0.75em",
            borderInlineStart: `3px solid ${inlineTranslateError ? "#dc2626" : theme.accent}`,
            backgroundColor: inlineTranslateError ? "rgba(220,38,38,0.08)" : `${theme.accent}12`,
            borderRadius: 6,
            fontSize: `${Math.max(13, settings.fontSize * 0.92)}px`,
            lineHeight: settings.lineHeight,
          }}
        >
          <div
            data-reader-toolbar
            dir="ltr"
            className="mb-1 flex items-center justify-between gap-2 text-[11px]"
            style={{ color: inlineTranslateError ? "#dc2626" : theme.muted }}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <span
              className="font-semibold uppercase tracking-wider"
              style={{ color: inlineTranslateError ? "#dc2626" : theme.accent }}
            >
              {inlineTranslateError
                ? "Translation notice"
                : `${inlineTranslationMeta?.languageName || "Translated"}${
                    inlineTranslationMeta?.nativeName
                      ? ` · ${inlineTranslationMeta.nativeName}`
                      : ""
                  }`}
            </span>
            {onCloseInlineTranslation && (
              <button
                type="button"
                aria-label="Close paragraph translation"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseInlineTranslation(block.id);
                }}
                className="rounded p-0.5 opacity-75 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <p style={{ margin: 0, overflowWrap: "break-word" }}>
            {inlineTranslateError ? (
              inlineTranslateError
            ) : (
              <TextContent
                text={inlineTranslatedText || ""}
                ranges={inlineSpeechRanges}
                accentColor={theme.accent}
              />
            )}
          </p>
        </div>
      ) : null;

    if (block.type === "heading") {
      const scale = block.level === 1 ? 1.5 : block.level === 2 ? 1.28 : 1.12;
      const Tag = `h${Math.min(block.level + 1, 4)}` as "h2" | "h3" | "h4";
      return (
        <div
          data-block-id={block.id}
          style={{
            margin: `${settings.fontSize * 1.1}px 0 ${settings.fontSize * 0.45}px`,
          }}
        >
          {actionButtons}
          <Tag
            data-block-text
            dir={block.dir}
            onDoubleClick={handleDoubleClick}
            style={{
              fontSize: `${settings.fontSize * scale}px`,
              lineHeight: 1.3,
              fontWeight: 700,
              margin: 0,
              letterSpacing: "-0.01em",
              overflowWrap: "break-word",
              textWrap: "balance",
            } as React.CSSProperties}
          >
            <TextContent text={text} ranges={ranges} accentColor={theme.accent} />
          </Tag>
          <span aria-hidden className="block clear-both" />
          {inlineTranslationCard}
        </div>
      );
    }

    return (
      <div
        data-block-id={block.id}
        style={{
          margin: `0 0 ${settings.fontSize * settings.paragraphSpacing}px`,
        }}
      >
        {actionButtons}
        <p
          data-block-text
          dir={block.dir}
          onDoubleClick={handleDoubleClick}
          style={{
            fontSize: `${settings.fontSize * (block.small ? 0.85 : 1)}px`,
            lineHeight: settings.lineHeight,
            margin: 0,
            textIndent: settings.firstLineIndent && block.indent && !block.quote ? "1.35em" : undefined,
            textAlign: settings.justify && !block.quote ? "justify" : "start",
            hyphens: settings.justify ? "auto" : undefined,
            WebkitHyphens: settings.justify ? "auto" : undefined,
            letterSpacing: settings.looseSpacing ? "0.02em" : undefined,
            wordSpacing: settings.looseSpacing ? "0.1em" : undefined,
            paddingInlineStart: block.quote ? "1em" : undefined,
            borderInlineStart: block.quote ? `3px solid ${theme.muted}66` : undefined,
            fontStyle: block.quote ? "italic" : undefined,
            color: block.small ? theme.muted : undefined,
            overflowWrap: "break-word",
            textWrap: settings.justify ? undefined : "pretty",
            orphans: 2,
            widows: 2,
            fontKerning: "normal",
            fontVariantLigatures: "common-ligatures",
            textRendering: "optimizeLegibility",
            WebkitFontSmoothing: "antialiased",
          } as React.CSSProperties}
        >
          <TextContent text={text} ranges={ranges} accentColor={theme.accent} />
        </p>
        <span aria-hidden className="block clear-both" />
        {inlineTranslationCard}
      </div>
    );
  }
);
BlockView.displayName = "BlockView";

/* ------------------------------- page images ------------------------------ */

/**
 * FullPageImage — rasterised original page (scanned book / broken font map).
 * It lives inline in the same continuous document, fitted to the viewport with
 * its aspect ratio preserved: never cropped, never stretched. Double tap or
 * ctrl/⌘ + wheel zooms; panning is enabled once zoomed in.
 */
const FullPageImage = ({ block }: { block: ImageBlock }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(block.blob);
    setSrc(url);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(url);
  }, [block.blob]);

  const zoomRef = useRef({ zoom, offset });
  zoomRef.current = { zoom, offset };

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const dy = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
      const state = zoomRef.current;
      const next = Math.min(5, Math.max(1, state.zoom * Math.exp(-dy * 0.0018)));
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left - rect.width / 2;
      const py = event.clientY - rect.top - rect.height / 2;
      const k = next / state.zoom;
      setZoom(next);
      setOffset(
        next <= 1.001
          ? { x: 0, y: 0 }
          : { x: px - (px - state.offset.x) * k, y: py - (py - state.offset.y) * k }
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomed = zoom > 1.01;

  return (
    <div
      ref={hostRef}
      data-block-id={block.id}
      data-page-image={zoomed ? "zoomed" : "fit"}
      className="flex w-full items-center justify-center overflow-hidden"
      style={{
        height: "min(88vh, var(--reader-vh, 88vh))",
        margin: "1em 0",
        touchAction: zoomed ? "none" : undefined,
        cursor: zoomed ? "grab" : undefined,
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (zoomed) {
          setZoom(1);
          setOffset({ x: 0, y: 0 });
        } else {
          setZoom(2.5);
        }
      }}
      onPointerDown={(event) => {
        if (!zoomed) return;
        dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        setOffset({ x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) });
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onClick={(event) => {
        if (zoomed) event.stopPropagation();
      }}
    >
      {src && (
        <img
          src={src}
          alt={block.alt || `Page ${block.page}`}
          loading="lazy"
          decoding="async"
          draggable={false}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            width: "auto",
            height: "auto",
            objectFit: "contain",
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: dragRef.current ? "none" : "transform 160ms ease-out",
            userSelect: "none",
          }}
        />
      )}
    </div>
  );
};

/* --------------------------------- helpers -------------------------------- */

function offsetWithin(root: HTMLElement, node: Node, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === node) return total + offset;
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return total;
}

/** One mounted block. Offscreen painting is skipped on large books only. */
const BlockSlot = memo(
  ({
    block,
    settings,
    highlights,
    searchQuery,
    activeSpeechForBlock,
    onSentenceDoubleClick,
    onParagraphAudioClick,
    onParagraphTranslateClick,
    onCloseInlineTranslation,
    inlineTranslatedText,
    isInlineTranslationVisible,
    isInlineTranslating,
    inlineTranslateError,
    inlineTranslationMeta,
    virtualize,
  }: {
    block: Block;
    settings: ReaderSettings;
    highlights: Highlight[];
    searchQuery?: string;
    activeSpeechForBlock?: ActiveSpeechInfo | null;
    onSentenceDoubleClick?: (blockId: string, sentenceIndex: number) => void;
    onParagraphAudioClick?: (blockId: string) => void;
    onParagraphTranslateClick?: (blockId: string) => void;
    onCloseInlineTranslation?: (blockId: string) => void;
    inlineTranslatedText?: string;
    isInlineTranslationVisible?: boolean;
    isInlineTranslating?: boolean;
    inlineTranslateError?: string;
    inlineTranslationMeta?: {
      languageName: string;
      nativeName: string;
      dir: "ltr" | "rtl";
    };
    virtualize: boolean;
  }) => {
    if (block.type === "image" && block.fullPage) {
      return <FullPageImage block={block} />;
    }
    const body = (
      <BlockView
        block={block}
        settings={settings}
        highlights={highlights}
        searchQuery={searchQuery}
        activeSpeechForBlock={activeSpeechForBlock}
        onSentenceDoubleClick={onSentenceDoubleClick}
        onParagraphAudioClick={onParagraphAudioClick}
        onParagraphTranslateClick={onParagraphTranslateClick}
        onCloseInlineTranslation={onCloseInlineTranslation}
        inlineTranslatedText={inlineTranslatedText}
        isInlineTranslationVisible={isInlineTranslationVisible}
        isInlineTranslating={isInlineTranslating}
        inlineTranslateError={inlineTranslateError}
        inlineTranslationMeta={inlineTranslationMeta}
      />
    );
    if (!virtualize) return body;
    return (
      <div
        style={{
          contentVisibility: "auto",
          containIntrinsicSize: `auto ${Math.round(settings.fontSize * 4)}px`,
        } as React.CSSProperties}
      >
        {body}
      </div>
    );
  }
);
BlockSlot.displayName = "BlockSlot";

const PaginatedReader = ({
  book,
  settings,
  highlights,
  searchQuery,
  jumpTo,
  navRequest,
  activeSpeech,
  onSentenceClick,
  onParagraphAudioClick,
  onParagraphTranslateClick,
  onCloseInlineTranslation,
  inlineTranslations,
  inlineTranslationVisible,
  inlineTranslatingIds,
  inlineTranslateErrors,
  inlineTranslationMeta,
  coverUrl,
  title,
  author,
  onLocationChange,
  onPaginationChange,
  onCreateHighlight,
  onTap,
  className,
}: Props) => {
  const theme = READER_THEMES[settings.theme];
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pagedRef = useRef<PagedFlowHandle>(null);
  /** Horizontal, one-screen-per-page reading. Scroll mode is the fallback. */
  const paged = settings.readingMode === "paged";


  const [selection, setSelection] = useState<{
    blockId: string;
    start: number;
    end: number;
    text: string;
    top: number;
    left: number;
  } | null>(null);

  /* --- sanitise blocks once per book revision -----------------------------
   * Second line of defence (older cached books were extracted before the
   * quality gate existed): repairs Unicode, then drops PDF metadata, glyph
   * soup and distributor boilerplate so only real book content can render.  */
  const blocks = useMemo(() => {
    const out: Block[] = [];
    for (const raw of book.blocks) {
      if (raw.type === "paragraph" || raw.type === "heading") {
        const text = normalizeReaderText(raw.text);
        if (!text || isHiddenMetadata(text) || isBoilerplate(text) || isGarbageLine(text)) continue;
        out.push({ ...raw, text });
      } else {
        out.push(raw);
      }
    }
    return out;
  }, [book.blocks]);

  // Offscreen skipping breaks CSS column measurement, so it stays scroll-only.
  const virtualize = !paged && blocks.length > VIRTUALIZE_THRESHOLD;

  /** Scanned / rasterised book: one existing page image becomes one page. */
  const imageMode = useMemo(() => {
    if (!blocks.length) return false;
    const pages = blocks.filter((b) => b.type === "image" && b.fullPage).length;
    return pages >= Math.max(1, Math.round(blocks.length * 0.6));
  }, [blocks]);


  // O(1) id lookups — linear scans here ran on every scroll frame.
  const blockIndexById = useMemo(() => {
    const map = new Map<string, number>();
    blocks.forEach((b, i) => map.set(b.id, i));
    return map;
  }, [blocks]);

  const originalIndexById = useMemo(() => {
    const map = new Map<string, number>();
    book.blocks.forEach((b, i) => map.set(b.id, i));
    return map;
  }, [book.blocks]);

  // Highlights bucketed per block so memoised blocks stay memoised.
  const highlightsByBlock = useMemo(() => {
    const map = new Map<string, Highlight[]>();
    for (const h of highlights) {
      const list = map.get(h.blockId);
      if (list) list.push(h);
      else map.set(h.blockId, [h]);
    }
    return map;
  }, [highlights]);

  /** Chapter titles by block index, for the running header/progress readout. */
  const chapterMarks = useMemo(() => {
    const marks: { index: number; title: string }[] = [];
    book.chapters.forEach((chapter) => {
      const original = book.blocks[chapter.blockIndex];
      if (!original) return;
      const index = blockIndexById.get(original.id);
      if (index !== undefined) marks.push({ index, title: chapter.title });
    });
    return marks.sort((a, b) => a.index - b.index);
  }, [book.chapters, book.blocks, blockIndexById]);

  /* ---------------------------- viewport metrics --------------------------- */
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const viewportHeight = viewportSize.height;
  const viewportWidth = viewportSize.width;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const apply = () => {
      setViewportSize((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight }
      );
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* ------------------------------- anchoring ------------------------------- */
  /** Topmost visible block + how far into it we are — the reflow anchor. */
  const anchorRef = useRef<{ id: string; offset: number } | null>(null);
  const restoringRef = useRef(false);

  const visibleBlockElement = useCallback(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return null;
    const nodes = content.querySelectorAll<HTMLElement>("[data-block-id]");
    const viewport = scroller.getBoundingClientRect();

    if (paged) {
      // In columns a single block can be fragmented across two pages, so the
      // first fragment that reaches into the current page wins.
      const left = viewport.left + 4;
      const right = viewport.right - 4;
      let fallback: HTMLElement | null = null;
      for (const node of Array.from(nodes)) {
        fallback = fallback ?? node;
        const rects = node.getClientRects();
        const list = rects.length ? Array.from(rects) : [node.getBoundingClientRect()];
        for (const rect of list) {
          if (rect.width === 0 && rect.height === 0) continue;
          if (rect.right >= left && rect.left <= right) return node;
        }
      }
      return fallback;
    }

    const top = viewport.top + 4;
    let fallback: HTMLElement | null = null;
    for (const node of Array.from(nodes)) {
      const rect = node.getBoundingClientRect();
      fallback = fallback ?? node;
      if (rect.bottom >= top) return node;
    }
    return fallback;
  }, [paged]);

  const captureAnchor = useCallback(() => {
    const scroller = scrollRef.current;
    const node = visibleBlockElement();
    if (!scroller || !node) return;
    const id = node.dataset.blockId;
    if (!id) return;
    anchorRef.current = {
      id,
      // Paged mode anchors to the page that holds the block; there is no
      // meaningful vertical offset to preserve across a re-columnisation.
      offset: paged
        ? 0
        : node.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
    };
  }, [paged, visibleBlockElement]);

  const scrollToBlock = useCallback(
    (blockId: string, offset = 0) => {
      if (paged) {
        // Restoration is a correction, never an animated page turn.
        return pagedRef.current?.goToBlock(blockId, false) ?? false;
      }
      const scroller = scrollRef.current;
      const content = contentRef.current;
      if (!scroller || !content) return false;
      const node = content.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
      if (!node) return false;
      const delta =
        node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
      restoringRef.current = true;
      scroller.scrollTop += delta;
      requestAnimationFrame(() => {
        restoringRef.current = false;
      });
      return true;
    },
    [paged]
  );


  // Typography / geometry changed → text truly reflows, and we land on the very
  // same sentence the reader was looking at (never a scaled or zoomed page).
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    // Two frames: one for layout, one after lazily-painted blocks settle.
    const raf1 = requestAnimationFrame(() => {
      scrollToBlock(anchor.id, anchor.offset);
      requestAnimationFrame(() => scrollToBlock(anchor.id, anchor.offset));
    });
    return () => cancelAnimationFrame(raf1);
  }, [
    settings.fontSize,
    settings.lineHeight,
    settings.font,
    settings.margin,
    settings.paragraphSpacing,
    settings.firstLineIndent,
    settings.justify,
    settings.looseSpacing,
    settings.theme,
    settings.readingMode,
    settings.pageSpread,
    viewportWidth,
    viewportHeight,
    scrollToBlock,
  ]);


  /* ------------------------- progress + location -------------------------- */
  const reportRef = useRef(0);

  const report = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    let page: number;
    let totalPages: number;
    let percent: number;

    if (paged) {
      const engine = pagedRef.current;
      totalPages = Math.max(1, engine?.totalPages() ?? 1);
      page = Math.min(totalPages, Math.max(1, engine?.page() ?? 1));
      percent = totalPages > 1 ? Math.round(((page - 1) / (totalPages - 1)) * 100) : 0;
    } else {
      const pageH = Math.max(scroller.clientHeight - 24, 1);
      totalPages = Math.max(1, Math.ceil(scroller.scrollHeight / pageH));
      page = Math.min(totalPages, Math.floor(scroller.scrollTop / pageH) + 1);
      const maxScroll = Math.max(scroller.scrollHeight - scroller.clientHeight, 1);
      percent = Math.min(100, Math.round((scroller.scrollTop / maxScroll) * 100));
    }


    const node = visibleBlockElement();
    const id = node?.dataset.blockId;
    const index = id ? blockIndexById.get(id) ?? -1 : -1;
    const block = index >= 0 ? blocks[index] : null;

    let chapterTitle = "";
    for (const mark of chapterMarks) {
      if (mark.index <= index) chapterTitle = mark.title;
      else break;
    }

    onPaginationChange?.({ page, totalPages, percent, chapterTitle });

    if (block && onLocationChange) {
      onLocationChange({
        blockIndex: originalIndexById.get(block.id) ?? index,
        blockId: block.id,
        page: block.page,
        percent,
        snippet: "text" in block ? block.text.slice(0, 60) : "",
      });
    }
  }, [
    blocks,
    blockIndexById,
    originalIndexById,
    chapterMarks,
    onLocationChange,
    onPaginationChange,
    paged,
    visibleBlockElement,
  ]);


  const handleScroll = useCallback(() => {
    if (reportRef.current) return;
    reportRef.current = requestAnimationFrame(() => {
      reportRef.current = 0;
      if (!restoringRef.current) captureAnchor();
      report();
    });
  }, [captureAnchor, report]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      captureAnchor();
      report();
    });
    return () => cancelAnimationFrame(raf);
  }, [captureAnchor, report, viewportWidth, viewportHeight]);

  useEffect(() => () => {
    if (reportRef.current) cancelAnimationFrame(reportRef.current);
  }, []);

  /* ------------------------------- navigation ------------------------------ */
  /** A "page turn" is a viewport move (scroll) or a column shift (paged). */
  const flip = useCallback(
    (delta: number) => {
      if (!delta) return;
      if (paged) {
        pagedRef.current?.flip(delta);
        return;
      }
      const scroller = scrollRef.current;
      if (!scroller) return;
      const pageH = Math.max(scroller.clientHeight - 24, 1);
      scroller.scrollTo({
        top: Math.max(
          0,
          Math.min(scroller.scrollHeight - scroller.clientHeight, scroller.scrollTop + delta * pageH)
        ),
        behavior: "smooth",
      });
    },
    [paged]
  );


  const navTokenRef = useRef(0);
  useEffect(() => {
    if (!navRequest || navRequest.token === navTokenRef.current) return;
    navTokenRef.current = navRequest.token;
    flip(navRequest.delta);
  }, [navRequest, flip]);

  // Jump to an arbitrary block (TOC, search, bookmarks, restored anchor).
  const jumpTokenRef = useRef(0);
  useEffect(() => {
    if (!jumpTo || jumpTo.token === jumpTokenRef.current) return;
    jumpTokenRef.current = jumpTo.token;
    const original = book.blocks[Math.max(0, Math.min(jumpTo.blockIndex, book.blocks.length - 1))];
    if (!original) return;
    // The target may have been filtered out — walk forward to the next kept one.
    let index = blockIndexById.get(original.id);
    if (index === undefined) {
      const from = Math.max(0, Math.min(jumpTo.blockIndex, book.blocks.length - 1));
      for (let i = from; i < book.blocks.length; i++) {
        const found = blockIndexById.get(book.blocks[i].id);
        if (found !== undefined) {
          index = found;
          break;
        }
      }
    }
    if (index === undefined) return;
    const targetId = blocks[index].id;
    const attempt = (tries: number) => {
      if (scrollToBlock(targetId, 0)) {
        anchorRef.current = { id: targetId, offset: 0 };
        report();
        return;
      }
      if (tries > 0) requestAnimationFrame(() => attempt(tries - 1));
    };
    requestAnimationFrame(() => attempt(4));
  }, [jumpTo, blockIndexById, blocks, book.blocks, scrollToBlock, report]);

  // Auto-keep spoken sentence in view during active TTS playback (both paged & scroll modes)
  useEffect(() => {
    if (!activeSpeech?.blockId) return;
    const raf = requestAnimationFrame(() => {
      if (paged) {
        pagedRef.current?.goToBlock(activeSpeech.blockId, true);
        report();
        return;
      }
      const scroller = scrollRef.current;
      const content = contentRef.current;
      if (!scroller || !content) return;
      const activeSpan = content.querySelector<HTMLElement>('[data-speech-active="true"]');
      const targetEl =
        activeSpan ||
        content.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(activeSpeech.blockId)}"]`);
      if (!targetEl) return;
      const sRect = scroller.getBoundingClientRect();
      const tRect = targetEl.getBoundingClientRect();
      if (tRect.top < sRect.top + 24 || tRect.bottom > sRect.bottom - 48) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [activeSpeech?.blockId, activeSpeech?.sentenceIndex, paged, report]);

  /* --------------------------- integrity validation ------------------------ */
  // Every extracted block must be mounted exactly once — no loss, no dupes.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const content = contentRef.current;
    if (!content) return;
    const raf = requestAnimationFrame(() => {
      const ids = Array.from(content.querySelectorAll<HTMLElement>("[data-block-id]")).map(
        (n) => n.dataset.blockId
      );
      const unique = new Set(ids);
      if (ids.length !== unique.size) {
        console.warn("[Reader] duplicated blocks in DOM", ids.length - unique.size);
      }
      if (unique.size !== blocks.length) {
        console.warn(
          `[Reader] block count mismatch: extracted ${blocks.length}, rendered ${unique.size}`
        );
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [blocks]);

  /* ------------------------------- selection ------------------------------ */
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const handleSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const startEl = (
        range.startContainer.nodeType === 1
          ? (range.startContainer as HTMLElement)
          : range.startContainer.parentElement
      )?.closest("[data-block-id]") as HTMLElement | null;
      if (!startEl || !container.contains(startEl)) {
        setSelection(null);
        return;
      }
      const textRoot = (startEl.querySelector("[data-block-text]") as HTMLElement | null) ?? startEl;
      if (!textRoot.contains(range.startContainer)) {
        setSelection(null);
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 2) {
        setSelection(null);
        return;
      }
      const start = offsetWithin(textRoot, range.startContainer, range.startOffset);
      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setSelection({
        blockId: startEl.dataset.blockId!,
        start,
        end: start + sel.toString().length,
        text,
        top: rect.top - containerRect.top - 48,
        left: Math.min(
          Math.max(rect.left - containerRect.left + rect.width / 2, 90),
          containerRect.width - 90
        ),
      });
    };
    document.addEventListener("selectionchange", handleSelection);
    return () => document.removeEventListener("selectionchange", handleSelection);
  }, []);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  /* -------------------------------- gestures ------------------------------ */
  const touchRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTouchRef = useRef(0);

  const handleTap = (clientX: number, host: HTMLElement) => {
    if (window.getSelection()?.isCollapsed === false) return;
    const rect = host.getBoundingClientRect();
    const ratio = (clientX - rect.left) / Math.max(rect.width, 1);
    if (ratio < 0.28) flip(-1);
    else if (ratio > 0.72) flip(1);
    else onTap?.();
  };

  const sidePadding = MARGIN_STEPS[settings.margin] ?? 26;

  /* --------------------------------- render -------------------------------- */
  /** One document, rendered identically in both modes. */
  const documentBody = (
    <>
      {/* Cover is simply the first thing in the flowing document. */}
      <div
        className="flex w-full flex-col items-center justify-center gap-5 text-center"
        style={
          paged
            ? { height: "100%", breakAfter: "column", breakInside: "avoid" }
            : { minHeight: "min(78vh, var(--reader-vh, 78vh))" }
        }
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={title ? `${title} cover` : "Book cover"}
            decoding="async"
            style={{
              maxHeight: "52vh",
              maxWidth: "78%",
              objectFit: "contain",
              borderRadius: 10,
              boxShadow: "0 10px 30px rgba(0,0,0,0.28)",
            }}
          />
        ) : null}
        <div>
          <h1
            style={{
              fontSize: `${settings.fontSize * 1.7}px`,
              lineHeight: 1.25,
              fontWeight: 700,
              margin: 0,
            }}
          >
            {title || book.meta.title || "Untitled"}
          </h1>
          {(author || book.meta.author) && (
            <p style={{ marginTop: 10, fontSize: `${settings.fontSize}px`, color: theme.muted }}>
              {author || book.meta.author}
            </p>
          )}
        </div>
      </div>

      {/* The whole book — one continuous document, every block exactly once. */}
      {blocks.map((block) => (
        <BlockSlot
          key={block.id}
          block={block}
          settings={settings}
          highlights={highlightsByBlock.get(block.id) ?? EMPTY_HIGHLIGHTS}
          searchQuery={searchQuery}
          activeSpeechForBlock={
            activeSpeech?.blockId === block.id ? activeSpeech : null
          }
          onSentenceDoubleClick={onSentenceClick}
          onParagraphAudioClick={onParagraphAudioClick}
          onParagraphTranslateClick={onParagraphTranslateClick}
          onCloseInlineTranslation={onCloseInlineTranslation}
          inlineTranslatedText={inlineTranslations?.[block.id]}
          isInlineTranslationVisible={Boolean(inlineTranslationVisible?.[block.id])}
          isInlineTranslating={Boolean(inlineTranslatingIds?.[block.id])}
          inlineTranslateError={inlineTranslateErrors?.[block.id]}
          inlineTranslationMeta={inlineTranslationMeta}
          virtualize={virtualize}
        />
      ))}

      {/* Breathing room so the final paragraph is always fully reachable. */}
      <div aria-hidden style={{ height: paged ? 1 : "18vh" }} />
    </>
  );

  const selectionToolbar =
    selection && onCreateHighlight ? (
      <div
        data-reader-toolbar
        className="fixed z-50 flex items-center gap-1 rounded-full px-1.5 py-1 shadow-lg"
        style={{
          top: Math.max((scrollRef.current?.getBoundingClientRect().top ?? 0) + selection.top, 8),
          left: (scrollRef.current?.getBoundingClientRect().left ?? 0) + selection.left,
          transform: "translateX(-50%)",
          backgroundColor: !isDarkReaderTheme(settings.theme) ? "#1f2430" : "#2b2f36",
          color: "#fff",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs hover:bg-white/15"
          onClick={() => {
            onCreateHighlight({ ...selection, withNote: false });
            clearSelection();
          }}
        >
          <Highlighter className="h-3.5 w-3.5" /> Highlight
        </button>
        <button
          type="button"
          className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs hover:bg-white/15"
          onClick={() => {
            onCreateHighlight({ ...selection, withNote: true });
            clearSelection();
          }}
        >
          <StickyNote className="h-3.5 w-3.5" /> Note
        </button>
        <button
          type="button"
          className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs hover:bg-white/15"
          onClick={() => {
            void navigator.clipboard?.writeText(selection.text);
            clearSelection();
          }}
        >
          <Copy className="h-3.5 w-3.5" /> Copy
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          className="rounded-full p-1.5 hover:bg-white/15"
          onClick={clearSelection}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    ) : null;

  const brightnessOverlayOpacity = Math.max(0, Math.min(0.5, 1 - (settings.brightness ?? 1)));
  const warmthOverlayOpacity = Math.max(0, Math.min(0.35, settings.warmth ?? 0));

  const surfaceOverlays = (
    <>
      {warmthOverlayOpacity > 0.005 && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-30"
          style={{
            backgroundColor: `rgba(255, 178, 82, ${warmthOverlayOpacity})`,
            mixBlendMode: theme.dark ? "screen" : "multiply",
          }}
        />
      )}
      {brightnessOverlayOpacity > 0.005 && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-30"
          style={{
            backgroundColor: `rgba(0, 0, 0, ${brightnessOverlayOpacity})`,
          }}
        />
      )}
    </>
  );

  if (paged) {
    return (
      <>
        <PagedFlow
          ref={pagedRef}
          settings={settings}
          imageMode={imageMode}
          dir={book.meta.dir}
          viewportRef={scrollRef}
          contentRef={contentRef}
          gap={sidePadding * 2}
          maxContentWidth={MAX_CONTENT_WIDTH[settings.margin] ?? 700}
          verticalPadding={20}
          className={className}
          style={{
            backgroundColor: theme.bg,
            color: theme.text,
            fontFamily: READER_FONT_STACKS[settings.font],
            ["--reader-vh" as string]: `${Math.max(viewportHeight, 200)}px`,
          } as React.CSSProperties}
          onTap={onTap}
          onChange={() => {
            if (!restoringRef.current) captureAnchor();
            report();
          }}
        >
          {documentBody}
        </PagedFlow>
        {surfaceOverlays}
        {selectionToolbar}
      </>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={cn(
        "relative h-full w-full select-text overflow-y-auto overflow-x-hidden",
        className
      )}
      style={{
        backgroundColor: theme.bg,
        color: theme.text,
        fontFamily: READER_FONT_STACKS[settings.font],
        // Continuous vertical scrolling — never locked, never clipped.
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
        scrollbarWidth: "none",
        ["--reader-vh" as string]: `${Math.max(viewportHeight, 200)}px`,
      } as React.CSSProperties}
      onTouchStart={(e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest("[data-reader-toolbar]")) {
          touchRef.current = null;
          return;
        }
        const t = e.touches[0];
        touchRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
      }}
      onTouchEnd={(e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest("[data-reader-toolbar]")) {
          touchRef.current = null;
          return;
        }
        const start = touchRef.current;
        touchRef.current = null;
        lastTouchRef.current = Date.now();
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          flip(dx < 0 ? 1 : -1);
          return;
        }
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && Date.now() - start.time < 400) {
          handleTap(t.clientX, e.currentTarget as HTMLElement);
        }
      }}
      onClick={(event) => {
        event.stopPropagation();
        const target = event.target as HTMLElement;
        if (target.closest("[data-reader-toolbar]")) return;
        if (target.closest('[data-page-image="zoomed"]')) return;
        if (Date.now() - lastTouchRef.current < 700) return;
        handleTap(event.clientX, event.currentTarget);
      }}
    >
      <div
        ref={contentRef}
        dir={book.meta.dir}
        style={{
          maxWidth: MAX_CONTENT_WIDTH[settings.margin] ?? 700,
          marginInline: "auto",
          paddingInline: sidePadding,
          paddingBlock: 20,
        }}
      >
        {documentBody}
      </div>
      {surfaceOverlays}
      {selectionToolbar}
    </div>
  );
};

export default PaginatedReader;
