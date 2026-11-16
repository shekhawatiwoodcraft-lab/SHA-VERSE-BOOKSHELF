import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX, Trash2, Eye, ExternalLink, Plus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { useAppPromotions } from '@/hooks/useAppPromotions';
import { toast } from 'sonner';
import { formatRemainingTime as formatRemaining } from '@/lib/promotions/statusDuration';

interface AppPromotionViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialIndex?: number;
  onAddNew?: () => void;
}

const SLIDE_DURATION_MS = 5000;

export default function AppPromotionViewer({
  open,
  onOpenChange,
  initialIndex = 0,
  onAddNew,
}: AppPromotionViewerProps) {
  const { promotions, isAppOwner, markViewed, deletePromotion } = useAppPromotions();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const prevOpenRef = useRef(false);

  // Reset index when viewer transitions open -> start at first unseen slide
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const safeStart = Math.max(0, Math.min(initialIndex, Math.max(0, promotions.length - 1)));
      setCurrentIndex(safeStart);
      setProgress(0);
      setPaused(false);
    }
    prevOpenRef.current = open;
  }, [open, initialIndex, promotions.length]);

  useEffect(() => {
    if (!open) return;
    if (promotions.length === 0) {
      onOpenChange(false);
      return;
    }
    if (currentIndex >= promotions.length) {
      setCurrentIndex(promotions.length - 1);
      setProgress(0);
    }
  }, [open, promotions.length, currentIndex, onOpenChange]);

  const activeItem = promotions[currentIndex];
  const activeItemId = activeItem?.id;
  const activeMediaType = activeItem?.media_type;

  // Record view
  useEffect(() => {
    if (open && activeItemId) {
      void markViewed(activeItemId);
    }
  }, [open, activeItemId, markViewed]);

  // Progress & auto-advance timer for image/text slides
  useEffect(() => {
    if (!open || !activeItemId || paused) return;
    if (activeMediaType === 'video') return;

    const intervalMs = 50;
    const step = (intervalMs / SLIDE_DURATION_MS) * 100;
    const timer = window.setInterval(() => {
      setProgress((prev) => {
        if (prev + step >= 100) {
          if (currentIndex < promotions.length - 1) {
            setCurrentIndex((i) => i + 1);
            return 0;
          }
          onOpenChange(false);
          return 100;
        }
        return prev + step;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [open, activeItemId, activeMediaType, paused, currentIndex, promotions.length, onOpenChange]);

  // Sync video playback with pause state
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (paused) vid.pause();
    else void vid.play().catch(() => {});
  }, [paused, activeItem?.id]);

  // Keyboard support in full-screen viewer (Esc close, Arrows prev/next, Space pause/play)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setProgress(0);
        setCurrentIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setProgress(0);
        setCurrentIndex((i) => {
          if (i < promotions.length - 1) return i + 1;
          onOpenChange(false);
          return i;
        });
      } else if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, promotions.length, onOpenChange]);

  if (!open || !activeItem) return null;

  const goPrev = () => {
    setProgress(0);
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  };

  const goNext = () => {
    setProgress(0);
    if (currentIndex < promotions.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      onOpenChange(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deletePromotion.mutateAsync(activeItem.id);
      toast.success('Status deleted');
    } catch {
      toast.error('Could not delete status');
    }
  };

  const safeHref =
    activeItem.link_url && /^https?:\/\//i.test(activeItem.link_url)
      ? activeItem.link_url
      : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] w-full h-full bg-black flex flex-col select-none overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="App status updates"
    >
      <div className="relative w-full h-full overflow-hidden bg-black flex flex-col">
        {/* Top Progress Bars & Controls */}
        <div
          className="absolute top-0 left-0 right-0 z-30 px-4 sm:px-6 pb-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}
        >
          <div className="max-w-5xl mx-auto w-full space-y-3">
            <div className="flex gap-1.5">
              {promotions.map((item, idx) => (
                <div key={item.id} className="h-1 flex-1 rounded-full bg-white/30 overflow-hidden">
                  <div
                    className="h-full bg-white transition-all duration-75"
                    style={{
                      width:
                        idx < currentIndex
                          ? '100%'
                          : idx === currentIndex
                          ? `${progress}%`
                          : '0%',
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Header */}
            <div className="flex items-center justify-between text-white gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src="/sha-verse-logo.jpeg"
                  alt="Sha-Verse"
                  className="w-9 h-9 rounded-full object-cover border border-white/40 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm sm:text-base font-semibold truncate">Sha-Verse</p>
                  <p className="text-[11px] sm:text-xs text-white/75 truncate">
                    {formatDistanceToNow(new Date(activeItem.created_at), { addSuffix: true })} ·{' '}
                    {formatRemaining(activeItem.expires_at)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {isAppOwner && onAddNew && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      onOpenChange(false);
                      onAddNew();
                    }}
                    aria-label="Add another status"
                    className="text-white hover:bg-white/20 h-9 w-9 rounded-full"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                )}
                {activeItem.media_type === 'video' && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setMuted((m) => !m)}
                    aria-label={muted ? 'Unmute video' : 'Mute video'}
                    className="text-white hover:bg-white/20 h-9 w-9 rounded-full"
                  >
                    {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setPaused((p) => !p)}
                  aria-label={paused ? 'Play story' : 'Pause story'}
                  className="text-white hover:bg-white/20 h-9 w-9 rounded-full"
                >
                  {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                </Button>
                {isAppOwner && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={handleDelete}
                    disabled={deletePromotion.isPending}
                    aria-label="Delete status"
                    className="text-white hover:bg-red-500/30 h-9 w-9 rounded-full"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  aria-label="Close story viewer"
                  className="text-white hover:bg-white/20 h-9 w-9 rounded-full"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Media / Text Content (Full Screen) */}
        <div className="relative flex-1 w-full h-full flex items-center justify-center bg-black overflow-hidden">
          {activeItem.media_type === 'text' ? (
            <div
              className="w-full h-full flex items-center justify-center p-8 sm:p-16 text-center"
              style={{
                background:
                  activeItem.background_color ||
                  'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
              }}
            >
              <p className="max-w-3xl text-white text-2xl sm:text-4xl font-bold leading-relaxed whitespace-pre-wrap break-words">
                {activeItem.text_content}
              </p>
            </div>
          ) : activeItem.media_type === 'video' ? (
            <video
              ref={videoRef}
              key={activeItem.id}
              src={activeItem.media_url}
              autoPlay
              playsInline
              muted={muted}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (v.duration > 0) {
                  setProgress((v.currentTime / v.duration) * 100);
                }
              }}
              onEnded={goNext}
              className="w-full h-full object-contain"
            />
          ) : (
            <img
              key={activeItem.id}
              src={activeItem.media_url}
              alt={activeItem.caption || 'Status update'}
              className="w-full h-full object-contain"
            />
          )}

          {/* Tap Navigation Zones */}
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous status"
            className="absolute inset-y-20 left-0 w-1/3 z-20 cursor-pointer focus:outline-none"
          />
          <button
            type="button"
            onClick={goNext}
            aria-label="Next status"
            className="absolute inset-y-20 right-0 w-2/3 z-20 cursor-pointer focus:outline-none"
          />

          {/* Tablet / Desktop Prev & Next Arrows */}
          {currentIndex > 0 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={goPrev}
              aria-label="Previous"
              className="hidden sm:flex absolute left-4 lg:left-6 top-1/2 -translate-y-1/2 z-30 h-11 w-11 rounded-full bg-black/55 border border-white/15 text-white hover:bg-black/80"
            >
              <ChevronLeft className="w-6 h-6" />
            </Button>
          )}
          {currentIndex < promotions.length - 1 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={goNext}
              aria-label="Next"
              className="hidden sm:flex absolute right-4 lg:right-6 top-1/2 -translate-y-1/2 z-30 h-11 w-11 rounded-full bg-black/55 border border-white/15 text-white hover:bg-black/80"
            >
              <ChevronRight className="w-6 h-6" />
            </Button>
          )}
        </div>

        {/* Footer Caption / Link / Views */}
        {(activeItem.caption || safeHref || isAppOwner) && (
          <div
            className="absolute bottom-0 left-0 right-0 z-30 px-4 sm:px-6 pt-6 bg-gradient-to-t from-black/85 via-black/55 to-transparent text-white"
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom, 1.25rem))' }}
          >
            <div className="max-w-5xl mx-auto w-full space-y-2.5">
              {activeItem.caption && (
                <p className="text-sm sm:text-base leading-snug text-center max-w-2xl mx-auto">
                  {activeItem.caption}
                </p>
              )}
              <div className="flex items-center justify-between gap-3">
                {isAppOwner ? (
                  <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-white/85">
                    <Eye className="w-4 h-4" />
                    {activeItem.views_count || 0} views
                  </span>
                ) : (
                  <span />
                )}
                {safeHref && (
                  <a
                    href={safeHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium bg-white text-black px-4 py-2 rounded-full hover:bg-white/90"
                  >
                    Open Link
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
