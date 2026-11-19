import { useAudiobook } from "@/contexts/AudiobookContext";
import type { ListeningProgressRecord } from "@/lib/ai/cache";
import {
  PLAYBACK_SPEEDS,
  getLanguageMeta,
  type GeminiPrebuiltVoiceId,
} from "@/lib/ai/languages";
import VoiceLibraryPanel from "@/components/bookshelf/reader/VoiceLibraryPanel";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";

interface AudioSettingsPanelProps {
  bookId: string;
  hasReadableFile: boolean;
  isPreparingBookText: boolean;
  preparingProgress?: number;
  isPreparingTranslation?: boolean;
  hasTextReady: boolean;
  displayPage: number;
  sourceLanguage: string;
  targetLanguage: string;
  hasTranslatedText: boolean;
  hasChosenTranslationLanguage: boolean;
  listenInTranslated: boolean;
  onChangeListenInTranslated: (useTranslated: boolean) => void;
  savedListenProgress: ListeningProgressRecord | null;
  onStartChoice: (mode: "resume" | "reading_pos" | "chapter" | "beginning") => void;
  onSelectVoiceAndStart: (voiceId: GeminiPrebuiltVoiceId) => void;
  onSyncPageToAudio?: () => void;
  onOpenTranslationTab?: () => void;
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AudioSettingsPanel({
  bookId,
  hasReadableFile,
  isPreparingBookText,
  preparingProgress,
  isPreparingTranslation = false,
  hasTextReady,
  displayPage,
  sourceLanguage,
  targetLanguage,
  hasTranslatedText,
  hasChosenTranslationLanguage,
  listenInTranslated,
  onChangeListenInTranslated,
  savedListenProgress,
  onStartChoice,
  onSelectVoiceAndStart,
  onSyncPageToAudio,
  onOpenTranslationTab,
}: AudioSettingsPanelProps) {
  const {
    session,
    status,
    error,
    errorCode,
    preferences,
    volume,
    currentTime,
    duration,
    sleepRemainingSec,
    activeSegment,
    togglePlayPause,
    pausePlayback,
    stopPlayback,
    nextChapter,
    prevChapter,
    seekDeltaSeconds,
    jumpToSegmentIndex,
    setStyleAndApply,
    updatePreferences,
    setSpeed,
    setVolume,
    setSleepTimer,
    retryCurrentSegment,
  } = useAudiobook();

  const isActiveForThisBook = session?.bookId === bookId && status !== "idle";
  const canUseTranslated = hasTranslatedText || hasChosenTranslationLanguage;
  const effectiveUseTranslated = listenInTranslated && canUseTranslated;
  const activeLanguageCode = isActiveForThisBook
    ? session.language
    : effectiveUseTranslated
      ? targetLanguage
      : sourceLanguage;
  const activeLangMeta = getLanguageMeta(activeLanguageCode);

  if (!hasReadableFile) {
    return (
      <div className="py-6 text-center space-y-2 text-sm">
        <p className="font-medium">No readable book file attached</p>
        <p className="text-xs opacity-70">
          AI Audiobook narration becomes available as soon as a PDF or EPUB book file is attached.
        </p>
      </div>
    );
  }

  const segCount = isActiveForThisBook ? Math.max(1, session.segments.length) : 1;
  const progressPct = isActiveForThisBook
    ? Math.round(((session.currentSegmentIndex + 1) / segCount) * 100)
    : 0;
  const currentChapter = isActiveForThisBook
    ? session.chapters[session.currentChapterIndex]
    : undefined;

  return (
    <div className="space-y-5 py-4 text-sm pb-8">
      {/* Live Player Card when this book is active */}
      {isActiveForThisBook ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                {status === "playing"
                  ? "Now Playing"
                  : status === "loading"
                    ? "Generating Audio..."
                    : status === "error"
                      ? "Playback Paused"
                      : "Paused"}
              </p>
              <p className="font-semibold text-sm truncate mt-0.5">
                {currentChapter?.title || session.bookTitle}
              </p>
              <p className="text-xs opacity-75 truncate">
                {activeLangMeta.name} ({activeLangMeta.nativeName}) · {preferences.preferredVoice} ·{" "}
                {session.currentSegmentIndex + 1}/{segCount} segments
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {onSyncPageToAudio && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onSyncPageToAudio}
                  className="h-8 px-2.5 text-xs"
                  title="Jump reading view to spoken sentence"
                >
                  Sync
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Stop audiobook playback"
                onClick={stopPlayback}
                className="h-8 px-2.5 text-xs"
              >
                Stop
              </Button>
            </div>
          </div>

          {status === "error" && error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 flex items-center justify-between gap-2 text-xs text-destructive">
              <span className="truncate">
                {errorCode === "AI_NOT_CONFIGURED"
                  ? "GEMINI_API_KEY is not configured on the server."
                  : error}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={retryCurrentSegment}
                className="h-7 px-2 text-xs shrink-0"
              >
                Retry
              </Button>
            </div>
          ) : activeSegment ? (
            <p className="text-xs opacity-80 line-clamp-2 italic" dir={activeLangMeta.dir}>
              "{activeSegment.text}"
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums opacity-70 w-9 text-right shrink-0">
              {formatClock(currentTime)}
            </span>
            <Slider
              aria-label="Audio chapter segment progress"
              value={[session.currentSegmentIndex]}
              min={0}
              max={Math.max(0, segCount - 1)}
              step={1}
              onValueChange={(v) => jumpToSegmentIndex(v[0])}
              className="flex-1"
            />
            <span className="text-[11px] tabular-nums opacity-70 w-9 shrink-0">
              {duration > 0 ? formatClock(duration) : `${progressPct}%`}
            </span>
          </div>

          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Previous chapter audio"
              disabled={session.currentChapterIndex <= 0}
              onClick={prevChapter}
              className="h-8 px-2 text-xs"
            >
              Prev Ch
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Rewind audio 10 seconds"
              onClick={() => seekDeltaSeconds(-10)}
              className="h-8 px-2 text-xs"
            >
              -10s
            </Button>
            <Button
              type="button"
              size="sm"
              aria-label={status === "playing" ? "Pause audio playback" : "Play audio playback"}
              onClick={togglePlayPause}
              className="h-9 px-4 text-xs font-semibold"
            >
              {status === "loading" ? "Loading..." : status === "playing" ? "Pause" : "Play"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Forward audio 10 seconds"
              onClick={() => seekDeltaSeconds(10)}
              className="h-8 px-2 text-xs"
            >
              +10s
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Next chapter audio"
              disabled={session.currentChapterIndex >= session.chapters.length - 1}
              onClick={nextChapter}
              className="h-8 px-2 text-xs"
            >
              Next Ch
            </Button>
          </div>
        </div>
      ) : null}

      {/* Narration Language Synced With Translation */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider opacity-70">
            Audio Language
          </p>
          {onOpenTranslationTab && (
            <button
              type="button"
              onClick={onOpenTranslationTab}
              className="text-xs text-primary font-medium hover:underline"
            >
              Change in Translation
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={!effectiveUseTranslated ? "default" : "outline"}
            size="sm"
            onClick={() => onChangeListenInTranslated(false)}
            className="text-xs h-9"
          >
            Original ({getLanguageMeta(sourceLanguage).name})
          </Button>
          <Button
            type="button"
            variant={effectiveUseTranslated ? "default" : "outline"}
            size="sm"
            disabled={!canUseTranslated}
            onClick={() => onChangeListenInTranslated(true)}
            className="text-xs h-9"
          >
            Translated ({getLanguageMeta(targetLanguage).nativeName})
          </Button>
        </div>

        {(isPreparingBookText && !hasTextReady) || isPreparingTranslation ? (
          <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs">
            {isPreparingTranslation
              ? `Translating into ${getLanguageMeta(targetLanguage).name} for narration...`
              : `Preparing book text for narration${
                  typeof preparingProgress === "number" && preparingProgress > 0
                    ? ` (${preparingProgress}%)`
                    : "..."
                }`}
          </div>
        ) : null}

        <div className="space-y-1.5 pt-1">
          <p className="text-xs font-medium opacity-75">
            {isActiveForThisBook ? "Jump or restart from" : "Start listening"}
          </p>

          {savedListenProgress && (
            <Button
              type="button"
              variant={isActiveForThisBook ? "outline" : "default"}
              disabled={!hasTextReady || isPreparingTranslation}
              className="w-full justify-start text-left h-auto py-2.5"
              onClick={() => onStartChoice("resume")}
            >
              <div>
                <div className="text-xs font-semibold">Resume previous listening</div>
                <div className="text-[11px] opacity-80">
                  {savedListenProgress.chapterTitle || "Saved position"} ·{" "}
                  {getLanguageMeta(savedListenProgress.language).name}
                </div>
              </div>
            </Button>
          )}

          <Button
            type="button"
            variant={savedListenProgress || isActiveForThisBook ? "outline" : "default"}
            disabled={!hasTextReady || isPreparingTranslation}
            className="w-full justify-start text-left h-9 text-xs font-medium"
            onClick={() => onStartChoice("reading_pos")}
          >
            Start from current reading position (p.{displayPage})
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!hasTextReady || isPreparingTranslation}
              className="justify-start text-left h-9 text-xs"
              onClick={() => onStartChoice("chapter")}
            >
              Current chapter
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!hasTextReady || isPreparingTranslation}
              className="justify-start text-left h-9 text-xs"
              onClick={() => onStartChoice("beginning")}
            >
              From beginning
            </Button>
          </div>
        </div>
      </div>

      <Separator />

      {/* Speed, Sleep Timer & Volume */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider opacity-70">
          Playback Controls
        </p>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Playback speed</span>
            <span className="tabular-nums opacity-75">{preferences.preferredSpeed}x</span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1">
            {PLAYBACK_SPEEDS.map((spd) => (
              <Button
                key={spd}
                type="button"
                size="sm"
                variant={Math.abs(preferences.preferredSpeed - spd) < 0.05 ? "default" : "outline"}
                onClick={() => setSpeed(spd)}
                className="h-8 px-1 text-xs tabular-nums"
              >
                {spd}x
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="space-y-1">
            <label htmlFor="audio-sleep-select" className="text-xs font-medium flex items-center gap-1">
              <span>Sleep timer</span>
              {sleepRemainingSec !== null && (
                <span className="ml-auto tabular-nums opacity-75">
                  {formatClock(sleepRemainingSec)}
                </span>
              )}
            </label>
            <select
              id="audio-sleep-select"
              value={preferences.sleepTimerMinutes}
              onChange={(e) => setSleepTimer(Number(e.target.value))}
              className="w-full h-9 rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value={0}>Off</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={-1}>End of chapter</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-medium">
              <span>Volume</span>
              <span className="tabular-nums opacity-75">{Math.round(volume * 100)}%</span>
            </div>
            <div className="h-9 flex items-center">
              <Slider
                aria-label="Audiobook volume"
                value={[Math.round(volume * 100)]}
                min={0}
                max={100}
                step={5}
                onValueChange={(v) => setVolume(v[0] / 100)}
              />
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* 18 Voice Profiles with Examples & Instant Auto-Start on Click */}
      <VoiceLibraryPanel
        languageCode={activeLanguageCode}
        preferences={preferences}
        onSelectVoice={onSelectVoiceAndStart}
        onSelectStyle={setStyleAndApply}
        onUpdatePreferences={updatePreferences}
        onBeforePreview={pausePlayback}
      />
    </div>
  );
}
