import { useMemo, useState } from "react";
import {
  SUPPORTED_LANGUAGES,
  TRANSLATION_QUALITY_OPTIONS,
  filterSupportedLanguages,
  getLanguageMeta,
  type TranslationQuality,
  type TranslationReadingMode,
} from "@/lib/ai/languages";
import type { Chapter } from "@/lib/reader/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TranslationPanelProps {
  sourceLanguage: string;
  onChangeSourceLanguage: (code: string) => void;
  onAutoDetectSource: () => void;
  isDetectingLanguage: boolean;
  targetLanguage: string;
  onSelectAndTranslateLanguage: (code: string) => void;
  quality: TranslationQuality;
  onChangeQuality: (q: TranslationQuality) => void;
  readingMode: TranslationReadingMode;
  onChangeReadingMode: (mode: TranslationReadingMode) => void;
  chapters: Chapter[];
  completedChapterIds: string[];
  failedChapterIds: string[];
  currentChapterIndex: number;
  isTranslating: boolean;
  translationProgress: { done: number; total: number; label: string } | null;
  translationError: string | null;
  translationErrorCode: string | null;
  hasTranslatedSample: boolean;
  onTranslateSample: () => void;
  onTranslateChapter: (chapterIndex: number) => void;
  onTranslateFullBook: () => void;
  onPauseTranslation: () => void;
  onRetryFailed: () => void;
  onListenTranslated: () => void;
}

export default function TranslationPanel({
  sourceLanguage,
  onChangeSourceLanguage,
  onAutoDetectSource,
  isDetectingLanguage,
  targetLanguage,
  onSelectAndTranslateLanguage,
  quality,
  onChangeQuality,
  readingMode,
  onChangeReadingMode,
  chapters,
  completedChapterIds,
  failedChapterIds,
  currentChapterIndex,
  isTranslating,
  translationProgress,
  translationError,
  translationErrorCode,
  hasTranslatedSample,
  onTranslateSample,
  onTranslateChapter,
  onTranslateFullBook,
  onPauseTranslation,
  onRetryFailed,
  onListenTranslated,
}: TranslationPanelProps) {
  const [langSearch, setLangSearch] = useState("");

  const srcMeta = getLanguageMeta(sourceLanguage);
  const tgtMeta = getLanguageMeta(targetLanguage);
  const filteredLanguages = useMemo(() => filterSupportedLanguages(langSearch), [langSearch]);

  const completedSet = useMemo(() => new Set(completedChapterIds), [completedChapterIds]);
  const currentChapter = chapters[currentChapterIndex];
  const currentChapterDone = currentChapter ? completedSet.has(currentChapter.id) : false;

  return (
    <div className="space-y-5 text-sm pb-8">
      {/* Original Language & Override */}
      <div className="rounded-lg border border-border/70 p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider opacity-70">
              Book Source Language
            </p>
            <p className="font-semibold text-sm">
              {srcMeta.name} · {srcMeta.nativeName}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isDetectingLanguage}
            onClick={onAutoDetectSource}
            className="h-8 px-2.5 text-xs shrink-0 whitespace-nowrap"
          >
            {isDetectingLanguage ? "Detecting..." : "Auto-detect"}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50">
          <label htmlFor="source-lang-select" className="text-xs opacity-75">
            Source override
          </label>
          <select
            id="source-lang-select"
            value={srcMeta.code}
            onChange={(e) => onChangeSourceLanguage(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs max-w-[60%]"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name} ({l.nativeName})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Searchable A-Z Language Menu: Clicking any language translates immediately */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider opacity-70">
            Translate To (A–Z · {filteredLanguages.length})
          </p>
          <span className="text-xs font-semibold text-primary">
            {tgtMeta.name} ({tgtMeta.nativeName})
            {tgtMeta.dir === "rtl" ? " · RTL" : ""}
          </span>
        </div>

        <Input
          aria-label="Search languages A to Z"
          value={langSearch}
          onChange={(e) => setLangSearch(e.target.value)}
          placeholder="Search any language A to Z (Hindi, Urdu, Spanish...)"
          className="h-9 text-xs"
        />

        <p className="text-[11px] opacity-70">
          Tap any language below to translate this book immediately and sync Audio Reader to that language.
        </p>

        <div
          className="max-h-60 overflow-y-auto rounded-lg border border-border/70 divide-y divide-border/50"
          role="listbox"
          aria-label="All languages A to Z"
        >
          {filteredLanguages.length === 0 ? (
            <div className="p-4 text-center text-xs opacity-70">
              No language matched "{langSearch}".
            </div>
          ) : (
            filteredLanguages.map((lang) => {
              const selected = lang.code === tgtMeta.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelectAndTranslateLanguage(lang.code)}
                  className={cn(
                    "w-full px-3 py-2 text-left text-xs transition-colors flex items-center justify-between gap-2",
                    selected
                      ? "bg-primary/10 font-semibold text-primary"
                      : "hover:bg-muted/50",
                  )}
                >
                  <span className="truncate">
                    {lang.name}{" "}
                    <span className="opacity-75 font-normal">({lang.nativeName})</span>
                  </span>
                  <span className="text-[11px] shrink-0 opacity-80">
                    {selected
                      ? isTranslating
                        ? "Translating..."
                        : "Selected"
                      : lang.dir === "rtl"
                        ? "RTL"
                        : "Translate"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Progress / Error Banner */}
      {translationProgress && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="truncate">{translationProgress.label}</span>
            <span className="shrink-0 tabular-nums">
              {translationProgress.done}/{translationProgress.total}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{
                width: `${Math.min(
                  100,
                  Math.round(
                    (translationProgress.done / Math.max(1, translationProgress.total)) * 100,
                  ),
                )}%`,
              }}
            />
          </div>
          {isTranslating && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onPauseTranslation}
              className="w-full h-8 text-xs"
            >
              Pause Translation
            </Button>
          )}
        </div>
      )}

      {translationError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-2 text-xs text-destructive">
          <div>
            <p className="font-semibold">
              {translationErrorCode === "AI_NOT_CONFIGURED"
                ? "AI Translation Not Configured"
                : "Translation Notice"}
            </p>
            <p className="opacity-90 mt-0.5">{translationError}</p>
          </div>
          {failedChapterIds.length > 0 && !isTranslating && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRetryFailed}
              className="h-8 text-xs border-destructive/40 text-destructive hover:bg-destructive/15"
            >
              Retry {failedChapterIds.length} Failed Section(s)
            </Button>
          )}
        </div>
      )}

      {/* Reading Mode */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider opacity-70">Reading View</p>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { id: "original" as const, label: "Original Only" },
            { id: "translated" as const, label: "Translated Only" },
            { id: "side_by_side" as const, label: "Side by Side" },
            { id: "paragraph_by_paragraph" as const, label: "Parallel Paragraphs" },
          ].map(({ id, label }) => {
            const active = readingMode === id;
            const disabled = id !== "original" && !hasTranslatedSample && !currentChapterDone;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChangeReadingMode(id)}
                className={cn(
                  "rounded-md border px-2.5 py-2 text-left text-xs transition-colors",
                  active
                    ? "border-primary bg-primary/10 font-semibold"
                    : "border-border/70 hover:bg-muted/40",
                  disabled && !active && "opacity-75",
                )}
              >
                <span className="truncate block">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Translation Quality */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider opacity-70">Translation Quality</p>
        <div className="space-y-1.5">
          {TRANSLATION_QUALITY_OPTIONS.map((opt) => {
            const active = quality === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeQuality(opt.id)}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border/70 hover:bg-muted/40",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{opt.label}</span>
                  {active && <span className="text-[11px] font-medium text-primary">Active</span>}
                </div>
                <p className="text-[11px] opacity-70 mt-0.5">{opt.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Extra Chapter / Full Book Controls */}
      <div className="space-y-2 pt-1">
        <div className="grid grid-cols-1 gap-2">
          <Button
            type="button"
            disabled={isTranslating}
            onClick={onTranslateSample}
            className="w-full h-10 text-xs font-semibold"
          >
            {isTranslating
              ? "Translating..."
              : `Translate Current Pages (${tgtMeta.nativeName})`}
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isTranslating || chapters.length === 0}
              onClick={() => onTranslateChapter(currentChapterIndex)}
              className="h-9 text-xs"
            >
              {currentChapterDone ? "Re-translate Chapter" : "Current Chapter"}
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={isTranslating || chapters.length === 0}
              onClick={onTranslateFullBook}
              className="h-9 text-xs"
            >
              Translate Full Book
            </Button>
          </div>
        </div>

        {(hasTranslatedSample || currentChapterDone) && (
          <Button
            type="button"
            variant="secondary"
            onClick={onListenTranslated}
            className="w-full h-9 text-xs font-medium"
          >
            Listen in {tgtMeta.name} ({tgtMeta.nativeName})
          </Button>
        )}

        <p className="text-[11px] opacity-65 text-center leading-relaxed">
          {completedChapterIds.length}/{Math.max(1, chapters.length)} chapters cached locally.
        </p>
      </div>
    </div>
  );
}
