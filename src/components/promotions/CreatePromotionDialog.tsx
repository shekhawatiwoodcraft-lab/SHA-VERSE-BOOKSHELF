import { useState, useRef } from 'react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ImagePlus, Type, Clock, X, Loader2, ArrowLeft, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAppPromotions } from '@/hooks/useAppPromotions';
import { cn } from '@/lib/utils';
import {
  type StatusDurationUnit as DurationUnit,
  toDurationMs,
  formatDurationLabel,
  getDaysInCurrentMonth,
} from '@/lib/promotions/statusDuration';

interface CreatePromotionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i + 1);

const QUICK_SHORT_DURATIONS: Array<{ label: string; value: number; unit: DurationUnit }> = [
  { label: '5 sec', value: 5, unit: 'seconds' },
  { label: '30 sec', value: 30, unit: 'seconds' },
  { label: '5 min', value: 5, unit: 'minutes' },
  { label: '30 min', value: 30, unit: 'minutes' },
];

const TEXT_BG_PRESETS = [
  { name: 'Royal Blue', value: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)' },
  { name: 'Sunset', value: 'linear-gradient(135deg, #f97316 0%, #db2777 100%)' },
  { name: 'Emerald', value: 'linear-gradient(135deg, #059669 0%, #0d9488 100%)' },
  { name: 'Midnight', value: 'linear-gradient(135deg, #0f172a 0%, #312e81 100%)' },
  { name: 'Rose', value: 'linear-gradient(135deg, #e11d48 0%, #9333ea 100%)' },
  { name: 'Amber', value: 'linear-gradient(135deg, #d97706 0%, #dc2626 100%)' },
];

function formatContinueChip(value: number, unit: DurationUnit): string {
  switch (unit) {
    case 'seconds':
      return `${value} s`;
    case 'minutes':
      return `${value} m`;
    case 'hours':
      return `${value} h`;
    case 'days':
      return `${value} d`;
  }
}

export default function CreatePromotionDialog({ open, onOpenChange }: CreatePromotionDialogProps) {
  const { createPromotions } = useAppPromotions();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'duration' | 'content'>('duration');
  const [durationValue, setDurationValue] = useState<number>(24);
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('hours');
  const [showCustomShort, setShowCustomShort] = useState(false);

  const [mode, setMode] = useState<'media' | 'text'>('media');
  const [selectedFiles, setSelectedFiles] = useState<
    Array<{ file: File; previewUrl: string; isVideo: boolean }>
  >([]);
  const [textContent, setTextContent] = useState('');
  const [bgColor, setBgColor] = useState(TEXT_BG_PRESETS[0].value);
  const [caption, setCaption] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files ?? []);
    if (!fileList.length) return;

    const added = fileList.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      isVideo: file.type.startsWith('video/'),
    }));

    setSelectedFiles((prev) => [...prev, ...added]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFileAt = (idx: number) => {
    setSelectedFiles((prev) => {
      const target = prev[idx];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const resetAndClose = () => {
    selectedFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setSelectedFiles([]);
    setTextContent('');
    setCaption('');
    setLinkUrl('');
    setDurationValue(24);
    setDurationUnit('hours');
    setShowCustomShort(false);
    setStep('duration');
    setMode('media');
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const ms = toDurationMs(durationValue, durationUnit);

    if (mode === 'media' && selectedFiles.length === 0) {
      toast.error('Please select at least one image or video');
      return;
    }
    if (mode === 'text' && !textContent.trim()) {
      toast.error('Please enter your status text');
      return;
    }

    try {
      await createPromotions.mutateAsync({
        files: mode === 'media' ? selectedFiles.map((s) => s.file) : undefined,
        textContent: mode === 'text' ? textContent : undefined,
        backgroundColor: bgColor,
        caption,
        linkUrl,
        durationMs: ms,
      });

      const countText =
        mode === 'media' && selectedFiles.length > 1
          ? `${selectedFiles.length} status updates posted`
          : 'Status update posted';
      toast.success(
        `${countText} · Auto-removes in ${formatDurationLabel(durationValue, durationUnit)}`,
      );
      resetAndClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to post status update';
      toast.error(msg || 'Failed to post status update');
    }
  };

  const daysInMonth = getDaysInCurrentMonth();
  const dayOptions = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const gridNumbers = durationUnit === 'days' ? dayOptions : HOUR_OPTIONS;

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : resetAndClose())}>
      <SheetContent
        side="left"
        className="w-full sm:max-w-[440px] p-0 flex flex-col bg-background border-r"
      >
        {step === 'duration' ? (
          <div className="flex flex-col h-full">
            {/* Header matching Screenshot 18 */}
            <div className="px-6 pt-5 pb-4 pr-12">
              <SheetTitle className="text-lg font-bold tracking-tight text-foreground">
                Story Kitni Der Tak Chalegi?
              </SheetTitle>
              <SheetDescription className="sr-only">
                Select how long the story stays active before auto-deleting.
              </SheetDescription>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-5">
              {/* Segmented Pill Toggle: Hours | Days (Month Days) */}
              <div className="grid grid-cols-2 rounded-2xl bg-muted/70 p-1.5 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setDurationUnit('hours');
                    if (durationUnit !== 'hours') {
                      setDurationValue((prev) => (prev >= 1 && prev <= 24 ? prev : 24));
                    }
                  }}
                  className={cn(
                    'py-2.5 px-3 rounded-xl text-sm font-semibold transition-all',
                    durationUnit === 'hours'
                      ? 'bg-[#1d63eb] text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Hours
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDurationUnit('days');
                    if (durationUnit !== 'days') {
                      setDurationValue((prev) => (prev >= 1 && prev <= daysInMonth ? prev : 7));
                    } else if (durationValue > daysInMonth) {
                      setDurationValue(daysInMonth);
                    }
                  }}
                  className={cn(
                    'py-2.5 px-3 rounded-xl text-sm font-semibold transition-all',
                    durationUnit === 'days'
                      ? 'bg-[#1d63eb] text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Days ({daysInMonth} Days)
                </button>
              </div>

              {/* Number Selection Grid (1-24 Hours or 1-MonthDays Days) */}
              <div className="grid grid-cols-6 sm:grid-cols-8 gap-2.5">
                {gridNumbers.map((num) => {
                  const isSelected =
                    (durationUnit === 'hours' || durationUnit === 'days') &&
                    durationValue === num;
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => {
                        if (durationUnit !== 'hours' && durationUnit !== 'days') {
                          setDurationUnit('hours');
                        }
                        setDurationValue(num);
                      }}
                      aria-label={`${num} ${durationUnit === 'days' ? 'days' : 'hours'}`}
                      aria-pressed={isSelected}
                      className={cn(
                        'h-11 rounded-xl text-sm font-semibold transition-all border',
                        isSelected
                          ? 'bg-[#1d63eb] text-white border-[#1d63eb] shadow-md shadow-blue-500/25'
                          : 'bg-card text-foreground border-border/60 hover:border-blue-400 hover:bg-muted/40 shadow-xs',
                      )}
                    >
                      {num}
                    </button>
                  );
                })}
              </div>

              {/* Subtle Quick Short Duration Option (5 sec - 30 min) */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowCustomShort((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Clock className="w-3.5 h-3.5" />
                  {showCustomShort ? 'Hide quick seconds / minutes' : 'Quick seconds / minutes (5s – 30m)'}
                </button>

                {showCustomShort && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {QUICK_SHORT_DURATIONS.map((preset) => {
                      const active =
                        durationUnit === preset.unit && durationValue === preset.value;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setDurationValue(preset.value);
                            setDurationUnit(preset.unit);
                          }}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                            active
                              ? 'bg-[#1d63eb] text-white border-[#1d63eb]'
                              : 'bg-muted/40 text-foreground border-border hover:border-blue-400',
                          )}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Footer matching Screenshot 18 */}
            <div className="px-6 py-4 border-t bg-background flex items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={resetAndClose}
                className="flex-1 h-12 rounded-2xl font-semibold text-sm bg-muted/70 hover:bg-muted"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => setStep('content')}
                className="flex-[1.5] h-12 rounded-2xl font-semibold text-sm bg-[#1d63eb] hover:bg-[#1a56cc] text-white shadow-md shadow-blue-500/25"
              >
                Continue · {formatContinueChip(durationValue, durationUnit)}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col h-full">
            {/* Step 2 Header */}
            <div className="px-5 pt-4 pb-3 pr-12 border-b flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setStep('duration')}
                  aria-label="Back to duration selection"
                  className="h-8 w-8 rounded-full shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <div className="min-w-0">
                  <SheetTitle className="text-base font-bold truncate">
                    Upload Story
                  </SheetTitle>
                  <SheetDescription className="text-xs flex items-center gap-1 text-[#1d63eb] font-medium">
                    <Clock className="w-3 h-3" />
                    Auto-deletes after {formatDurationLabel(durationValue, durationUnit)}
                  </SheetDescription>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <Tabs value={mode} onValueChange={(v) => setMode(v as 'media' | 'text')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="media" className="gap-2">
                    <ImagePlus className="w-4 h-4" />
                    Images / Video
                  </TabsTrigger>
                  <TabsTrigger value="text" className="gap-2">
                    <Type className="w-4 h-4" />
                    Text Story
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="media" className="space-y-3 pt-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    onChange={handleFilesSelected}
                    className="hidden"
                  />

                  {selectedFiles.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full h-44 rounded-xl border-2 border-dashed border-border hover:border-[#1d63eb]/60 bg-muted/30 flex flex-col items-center justify-center gap-2 transition-colors"
                    >
                      <ImagePlus className="w-8 h-8 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        Select single or multiple images / videos
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Upload multiple stories at once
                      </span>
                    </button>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {selectedFiles.map((item, idx) => (
                        <div
                          key={item.previewUrl}
                          className="relative aspect-[3/4] rounded-lg overflow-hidden bg-muted border"
                        >
                          {item.isVideo ? (
                            <video
                              src={item.previewUrl}
                              className="w-full h-full object-cover"
                              muted
                            />
                          ) : (
                            <img
                              src={item.previewUrl}
                              alt={`Selected ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => removeFileAt(idx)}
                            aria-label={`Remove media ${idx + 1}`}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="aspect-[3/4] rounded-lg border-2 border-dashed border-border hover:border-[#1d63eb]/60 flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
                      >
                        <ImagePlus className="w-5 h-5" />
                        Add More
                      </button>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="text" className="space-y-3 pt-2">
                  <div
                    className="w-full min-h-[160px] rounded-xl p-5 flex items-center justify-center text-white text-center shadow-inner"
                    style={{ background: bgColor }}
                  >
                    <Textarea
                      value={textContent}
                      onChange={(e) => setTextContent(e.target.value)}
                      placeholder="Write your announcement or story text..."
                      className="bg-transparent border-0 text-white placeholder:text-white/70 text-center text-lg font-semibold resize-none focus-visible:ring-0 min-h-[110px]"
                      maxLength={500}
                    />
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground mr-1">Background:</span>
                    {TEXT_BG_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => setBgColor(preset.value)}
                        aria-label={preset.name}
                        className={cn(
                          'w-7 h-7 rounded-full border-2 transition-transform',
                          bgColor === preset.value
                            ? 'border-foreground scale-110'
                            : 'border-transparent',
                        )}
                        style={{ background: preset.value }}
                      />
                    ))}
                  </div>
                </TabsContent>
              </Tabs>

              <div className="space-y-2">
                <Label htmlFor="status-caption" className="text-xs text-muted-foreground">
                  Caption (optional)
                </Label>
                <Input
                  id="status-caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Add a caption..."
                  maxLength={280}
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="status-link"
                  className="text-xs text-muted-foreground flex items-center gap-1"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Action Link URL (optional)
                </Label>
                <Input
                  id="status-link"
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="px-5 py-4 border-t bg-background flex items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep('duration')}
                disabled={createPromotions.isPending}
                className="flex-1 h-11 rounded-2xl font-semibold"
              >
                Back
              </Button>
              <Button
                type="submit"
                disabled={createPromotions.isPending}
                className="flex-[1.5] h-11 rounded-2xl font-semibold bg-[#1d63eb] hover:bg-[#1a56cc] text-white shadow-md shadow-blue-500/25"
              >
                {createPromotions.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Posting...
                  </>
                ) : mode === 'media' && selectedFiles.length > 1 ? (
                  `Post ${selectedFiles.length} Stories`
                ) : (
                  'Post Status'
                )}
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
