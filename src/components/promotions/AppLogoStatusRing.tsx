import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppPromotions } from '@/hooks/useAppPromotions';
import { buildStatusRingSegments, findFirstUnviewedIndex } from '@/lib/promotions/statusRing';
import AppPromotionViewer from './AppPromotionViewer';
import CreatePromotionDialog from './CreatePromotionDialog';
import PromoteWithUsSheet from './PromoteWithUsSheet';

interface Props {
  src: string;
  alt?: string;
  className?: string;
  size?: string;
  showPlus?: boolean;
}

const UNCOLORED_VISITED_STROKE = 'rgba(148, 163, 184, 0.55)';

const AppLogoStatusRing = ({
  src,
  alt = 'App Logo',
  className,
  size = 'w-9 h-9',
  showPlus = false,
}: Props) => {
  const { promotions, viewedIds, hasActive, isAppOwner } = useAppPromotions();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [initialSlideIndex, setInitialSlideIndex] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const gradientId = useId();

  const ring = buildStatusRingSegments(promotions, viewedIds);
  const statusState = ring.hasUnviewed
    ? ring.viewedCount > 0
      ? 'partial'
      : 'unseen'
    : ring.hasActive
    ? 'seen'
    : 'none';

  const handlePlusClick = () => {
    if (isAppOwner) {
      setCreateOpen(true);
    } else {
      setPromoteOpen(true);
    }
  };

  const handleLogoClick = () => {
    if (hasActive) {
      setInitialSlideIndex(findFirstUnviewedIndex(promotions, viewedIds));
      setViewerOpen(true);
    } else if (showPlus) {
      handlePlusClick();
    }
  };

  return (
    <>
      <div className={cn('relative inline-flex items-center justify-center', className)}>
        <div
          onClick={handleLogoClick}
          role={hasActive || showPlus ? 'button' : undefined}
          tabIndex={hasActive || showPlus ? 0 : undefined}
          onKeyDown={(e) => {
            if ((hasActive || showPlus) && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              handleLogoClick();
            }
          }}
          aria-label={
            hasActive
              ? 'View status updates'
              : showPlus
              ? isAppOwner
                ? 'Update app status'
                : 'Promote on Sha-Verse'
              : alt
          }
          data-status-state={statusState}
          className={cn(
            'relative rounded-full block transition-transform select-none',
            size,
            (hasActive || showPlus) && 'cursor-pointer hover:scale-105',
            ring.hasUnviewed && 'shadow-[0_0_12px_rgba(236,72,153,0.45)]',
          )}
        >
          {ring.hasActive && (
            <svg
              viewBox="0 0 40 40"
              aria-hidden="true"
              data-testid="status-ring-svg"
              className={cn(
                'absolute inset-0 w-full h-full pointer-events-none',
                ring.hasUnviewed && 'animate-status-ring',
              )}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#f59e0b" />
                  <stop offset="28%" stopColor="#ec4899" />
                  <stop offset="56%" stopColor="#8b5cf6" />
                  <stop offset="80%" stopColor="#06b6d4" />
                  <stop offset="100%" stopColor="#22c55e" />
                </linearGradient>
              </defs>
              {ring.count === 1 ? (
                <circle
                  cx={20}
                  cy={20}
                  r={18.2}
                  fill="none"
                  strokeWidth={2.8}
                  stroke={ring.segments[0].viewed ? UNCOLORED_VISITED_STROKE : `url(#${gradientId})`}
                  data-status-segment="0"
                  data-segment-viewed={String(ring.segments[0].viewed)}
                />
              ) : (
                ring.segments.map((seg) => (
                  <path
                    key={seg.id}
                    d={seg.d}
                    fill="none"
                    strokeWidth={2.8}
                    strokeLinecap="round"
                    stroke={seg.viewed ? UNCOLORED_VISITED_STROKE : `url(#${gradientId})`}
                    data-status-segment={seg.index}
                    data-segment-viewed={String(seg.viewed)}
                  />
                ))
              )}
            </svg>
          )}

          <div
            className={cn(
              'rounded-full overflow-hidden bg-background',
              ring.hasActive ? 'absolute inset-[4px]' : 'w-full h-full',
            )}
          >
            <img src={src} alt={alt} className="w-full h-full object-cover" draggable={false} />
          </div>
        </div>

        {showPlus && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePlusClick();
            }}
            aria-label={isAppOwner ? 'Add status update' : 'Promote on Sha-Verse'}
            title={isAppOwner ? 'Update Status' : 'Promote on Sha-Verse'}
            data-testid="app-logo-plus-btn"
            className="absolute -bottom-0.5 -right-0.5 z-10 w-4 h-4 rounded-full bg-[#1d63eb] text-white border-2 border-background flex items-center justify-center shadow-sm hover:scale-110 transition-transform"
          >
            <Plus className="w-2.5 h-2.5 stroke-[3]" />
          </button>
        )}
      </div>

      {viewerOpen && (
        <AppPromotionViewer
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          initialIndex={initialSlideIndex}
          onAddNew={isAppOwner ? () => setCreateOpen(true) : undefined}
        />
      )}

      {isAppOwner && createOpen && (
        <CreatePromotionDialog open={createOpen} onOpenChange={setCreateOpen} />
      )}

      {!isAppOwner && promoteOpen && (
        <PromoteWithUsSheet open={promoteOpen} onOpenChange={setPromoteOpen} />
      )}
    </>
  );
};

export default AppLogoStatusRing;
