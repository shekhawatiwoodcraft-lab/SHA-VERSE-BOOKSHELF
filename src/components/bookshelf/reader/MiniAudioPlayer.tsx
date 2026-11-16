import { useLocation, useNavigate } from "react-router-dom";
import {
  Play,
  Pause,
  X,
  RotateCcw,
  RotateCw,
  Loader2,
  BookOpen,
  Maximize2,
} from "lucide-react";
import { useAudiobook } from "@/contexts/AudiobookContext";
import { getLanguageMeta } from "@/lib/ai/languages";
import { Button } from "@/components/ui/button";

export default function MiniAudioPlayer() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    session,
    status,
    preferences,
    isMinimized,
    togglePlayPause,
    seekDeltaSeconds,
    stopPlayback,
    setMinimized,
    setDrawerOpen,
  } = useAudiobook();

  if (!session) return null;

  const isInsideTargetReader = location.pathname === `/bookshelf/read/${session.bookId}`;
  // Inside active reader when drawer is open & unminimized, AudiobookPlayer handles display.
  if (isInsideTargetReader && !isMinimized) return null;

  const chapter = session.chapters[session.currentChapterIndex];
  const langMeta = getLanguageMeta(session.language);

  return (
    <div
      className="fixed bottom-3 inset-x-3 sm:left-auto sm:right-4 sm:w-[400px] z-[65] rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-xl p-2.5 flex items-center gap-3"
      style={{
        marginBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* Cover Thumbnail */}
      <button
        type="button"
        onClick={() => {
          setMinimized(false);
          setDrawerOpen(true);
          if (!isInsideTargetReader) {
            navigate(`/bookshelf/read/${session.bookId}`);
          }
        }}
        className="w-10 h-12 rounded-md overflow-hidden bg-muted shrink-0 flex items-center justify-center border border-border/60"
        title="Open book and expand player"
      >
        {session.coverUrl ? (
          <img
            src={session.coverUrl}
            alt={session.bookTitle}
            className="w-full h-full object-cover"
          />
        ) : (
          <BookOpen className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {/* Book & Chapter Info */}
      <button
        type="button"
        onClick={() => {
          setMinimized(false);
          setDrawerOpen(true);
          if (!isInsideTargetReader) {
            navigate(`/bookshelf/read/${session.bookId}`);
          }
        }}
        className="flex-1 min-w-0 text-left"
      >
        <p className="text-xs font-semibold truncate text-foreground">{session.bookTitle}</p>
        <p className="text-[11px] text-muted-foreground truncate">
          {chapter?.title || "Reading"} · {langMeta.name} ({preferences.preferredSpeed}x)
        </p>
      </button>

      {/* Controls */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Rewind 10 seconds"
          className="h-8 w-8"
          onClick={() => seekDeltaSeconds(-10)}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </Button>

        <Button
          type="button"
          size="icon"
          aria-label={status === "playing" ? "Pause audio" : "Play audio"}
          className="h-9 w-9 rounded-full"
          onClick={togglePlayPause}
        >
          {status === "loading" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : status === "playing" ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4 ml-0.5 fill-current" />
          )}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Forward 10 seconds"
          className="h-8 w-8 hidden sm:inline-flex"
          onClick={() => seekDeltaSeconds(10)}
        >
          <RotateCw className="w-3.5 h-3.5" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Expand audiobook player"
          className="h-8 w-8"
          onClick={() => {
            setMinimized(false);
            setDrawerOpen(true);
            if (!isInsideTargetReader) {
              navigate(`/bookshelf/read/${session.bookId}`);
            }
          }}
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close audiobook"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={stopPlayback}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
