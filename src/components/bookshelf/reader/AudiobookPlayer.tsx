import { useState } from "react";
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Volume2,
  Clock,
  ChevronDown,
  LocateFixed,
  Loader2,
  SlidersHorizontal,
  AlertCircle,
} from "lucide-react";
import { useAudiobook } from "@/contexts/AudiobookContext";
import { PLAYBACK_SPEEDS, getLanguageMeta } from "@/lib/ai/languages";
import VoiceLibraryPanel from "@/components/bookshelf/reader/VoiceLibraryPanel";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface AudiobookPlayerProps {
  chromeBg: string;
  textColor: string;
  borderColor: string;
  onSyncTextToAudio?: () => void;
  isMobile?: boolean;
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const SCOPE_LABELS: Record<string, string> = {
  selection: "Selected Text",
  paragraph: "Paragraph",
  page: "Page",
  chapter: "Chapter",
  book: "Full Book",
};

export default function AudiobookPlayer({
  chromeBg,
  textColor,
  borderColor,
  onSyncTextToAudio,
  isMobile = false,
}: AudiobookPlayerProps) {
  const {
    session,
    status,
    activeEngine,
    error,
    errorCode,
    preferences,
    isDrawerOpen,
    isMinimized,
    volume,
    currentTime,
    duration,
    sleepRemainingSec,
    activeSegment,
    togglePlayPause,
    pausePlayback,
    stopPlayback,
    nextSegment,
    prevSegment,
    nextPageAudio,
    prevPageAudio,
    nextChapter,
    prevChapter,
    seekDeltaSeconds,
    jumpToSegmentIndex,
    setVoiceAndApply,
    setBrowserVoiceAndApply,
    setAudioEngineAndApply,
    setStyleAndApply,
    updatePreferences,
    setSpeed,
    setVolume,
    setSleepTimer,
    setMinimized,
    setDrawerOpen,
    retryCurrentSegment,
  } = useAudiobook();

  const [showVoiceSheet, setShowVoiceSheet] = useState(false);

  if (!session || !isDrawerOpen || isMinimized) return null;

  const currentChapter = session.chapters[session.currentChapterIndex];
  const langMeta = getLanguageMeta(session.language);
  const segCount = Math.max(1, session.segments.length);
  const progressPct = Math.round(((session.currentSegmentIndex + 1) / segCount) * 100);
  const totalBookPages = Math.max(1, session.reflowBook.meta.totalPages || 1);
  const displayAudioPage = activeSegment?.page || session.currentPage || 1;
  const scopeBadge =
    session.scope === "page"
      ? `Page ${displayAudioPage}`
      : SCOPE_LABELS[session.scope] || "Full Book";

  const cycleSpeed = () => {
    const idx = PLAYBACK_SPEEDS.findIndex((s) => Math.abs(s - preferences.preferredSpeed) < 0.05);
    const next = PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length];
    setSpeed(next);
  };

  return (
    <div
      data-testid="audiobook-player-dock"
      className={cn(
        "fixed inset-x-0 bottom-0 z-[55] border-t backdrop-blur-md shadow-xl transition-transform duration-200",
      )}
      style={{
        backgroundColor: chromeBg,
        color: textColor,
        borderColor,
        paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="max-w-3xl mx-auto px-3 sm:px-5 pt-2.5 space-y-2">
        {/* Top Row: Chapter/Scope/Engine + Voice + Sync + Minimize + Stop */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold truncate">
                {session.scope === "selection"
                  ? "Selected Text Audio"
                  : currentChapter?.title || session.bookTitle}
              </p>
              <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded border border-current/20 opacity-85">
                {scopeBadge}
              </span>
            </div>
            <p className="text-[11px] opacity-75 truncate">
              {langMeta.name} ({langMeta.nativeName}) ·{" "}
              {activeEngine === "browser" ? "Device Voice (Free)" : preferences.preferredVoice} ·{" "}
              {session.currentSegmentIndex + 1}/{segCount} ({progressPct}%)
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {onSyncTextToAudio && session.scope !== "selection" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onSyncTextToAudio}
                className="h-8 px-2 text-xs whitespace-nowrap"
                title="Jump reading view to current spoken sentence"
              >
                <LocateFixed className="w-3.5 h-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Sync Page</span>
              </Button>
            )}

            <Sheet open={showVoiceSheet} onOpenChange={setShowVoiceSheet}>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs whitespace-nowrap"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">Voice</span>
                </Button>
              </SheetTrigger>
              <SheetContent
                side={isMobile ? "bottom" : "right"}
                className={cn(
                  "overflow-y-auto z-[70]",
                  isMobile && "max-h-[80vh] rounded-t-2xl",
                )}
              >
                <SheetHeader>
                  <SheetTitle>AI &amp; Device Voice Settings</SheetTitle>
                  <SheetDescription className="sr-only">
                    Select an AI narrator voice, free device voice, narration style, and dialogue settings.
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-4">
                  <VoiceLibraryPanel
                    languageCode={session.language}
                    preferences={preferences}
                    activeEngine={activeEngine}
                    onSelectVoice={setVoiceAndApply}
                    onSelectBrowserVoice={setBrowserVoiceAndApply}
                    onChangeAudioEngine={setAudioEngineAndApply}
                    onSelectStyle={setStyleAndApply}
                    onUpdatePreferences={updatePreferences}
                    onBeforePreview={pausePlayback}
                  />
                </div>
              </SheetContent>
            </Sheet>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Minimize audiobook player"
              className="h-8 w-8"
              onClick={() => {
                setMinimized(true);
                setDrawerOpen(false);
              }}
            >
              <ChevronDown className="w-4 h-4" />
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Stop audiobook"
              className="h-8 w-8"
              onClick={stopPlayback}
            >
              <Square className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Active Spoken Line Preview or Error */}
        {status === "error" && error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs text-destructive">
            <div className="flex items-center gap-1.5 min-w-0">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {errorCode === "AI_NOT_CONFIGURED"
                  ? "Studio TTS unavailable; try Free Device Voice in Voice settings."
                  : error}
              </span>
            </div>
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
          <p className="text-xs opacity-80 truncate px-0.5" dir={langMeta.dir}>
            {activeSegment.text}
          </p>
        ) : null}

        {/* Segment Scrub Bar */}
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] tabular-nums opacity-70 w-9 text-right shrink-0">
            {formatClock(currentTime)}
          </span>
          <Slider
            aria-label="Segment progress"
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

        {/* Main Transport: Prev/Next Chapter, Prev/Next Page, Prev/Next Paragraph, -10s/+10s, Play/Pause */}
        <div className="flex items-center justify-between gap-1.5 flex-wrap">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={cycleSpeed}
              className="h-8 px-2 text-xs font-semibold tabular-nums whitespace-nowrap"
              title="Playback speed (0.5x - 2.0x)"
            >
              {preferences.preferredSpeed}x
            </Button>

            <select
              aria-label="Sleep timer"
              value={preferences.sleepTimerMinutes}
              onChange={(e) => setSleepTimer(Number(e.target.value))}
              className="h-8 rounded-md border border-border/70 bg-transparent px-1.5 text-xs"
              title="Sleep timer"
            >
              <option value={0}>Timer: Off</option>
              <option value={10}>10m</option>
              <option value={15}>15m</option>
              <option value={30}>30m</option>
              <option value={-1}>End ch.</option>
            </select>
            {sleepRemainingSec !== null && (
              <span className="text-[11px] tabular-nums opacity-75 hidden sm:inline">
                <Clock className="w-3 h-3 inline mr-0.5" />
                {formatClock(sleepRemainingSec)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-0.5 sm:gap-1">
            {session.scope !== "selection" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Previous chapter"
                title="Previous chapter"
                disabled={session.currentChapterIndex <= 0}
                onClick={prevChapter}
                className="h-8 w-8 hidden sm:inline-flex"
              >
                <SkipBack className="w-4 h-4" />
              </Button>
            )}

            {session.scope !== "selection" && totalBookPages > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Previous page audio"
                title="Previous page"
                disabled={displayAudioPage <= 1}
                onClick={prevPageAudio}
                className="h-8 px-1.5 text-[11px]"
              >
                Pg-
              </Button>
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Previous paragraph"
              title="Previous paragraph"
              disabled={session.currentSegmentIndex <= 0 && session.currentChapterIndex <= 0}
              onClick={prevSegment}
              className="h-8 w-8"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Rewind 10 seconds"
              onClick={() => seekDeltaSeconds(-10)}
              className="h-8 w-8"
              title="-10s"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>

            <Button
              type="button"
              size="icon"
              aria-label={status === "playing" ? "Pause audiobook" : "Play audiobook"}
              onClick={togglePlayPause}
              className="h-10 w-10 rounded-full shrink-0"
            >
              {status === "loading" ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : status === "playing" ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 ml-0.5 fill-current" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Forward 10 seconds"
              onClick={() => seekDeltaSeconds(10)}
              className="h-8 w-8"
              title="+10s"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Next paragraph"
              title="Next paragraph"
              disabled={
                session.currentSegmentIndex >= session.segments.length - 1 &&
                session.currentChapterIndex >= session.chapters.length - 1
              }
              onClick={nextSegment}
              className="h-8 w-8"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>

            {session.scope !== "selection" && totalBookPages > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Next page audio"
                title="Next page"
                disabled={displayAudioPage >= totalBookPages}
                onClick={nextPageAudio}
                className="h-8 px-1.5 text-[11px]"
              >
                Pg+
              </Button>
            )}

            {session.scope !== "selection" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Next chapter"
                title="Next chapter"
                disabled={session.currentChapterIndex >= session.chapters.length - 1}
                onClick={nextChapter}
                className="h-8 w-8 hidden sm:inline-flex"
              >
                <SkipForward className="w-4 h-4" />
              </Button>
            )}
          </div>

          {/* Volume Control (available on mobile + desktop) */}
          <div className="flex items-center gap-1.5 w-20 sm:w-24 shrink-0">
            <Volume2 className="w-3.5 h-3.5 opacity-70 shrink-0" />
            <Slider
              aria-label="Audio volume"
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
  );
}
