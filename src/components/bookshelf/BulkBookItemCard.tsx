import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Loader2,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BOOK_CATEGORIES, type BookCategory } from "@/lib/constants/bookshelf";
import { WORLD_LANGUAGES } from "@/lib/constants/languages";
import type { CoverSource } from "@/modules/bookshelf/lib/bookAutoDetector";

export interface BulkBookQueueItem {
  id: string;
  bookFile: File;
  coverFile: File | null;
  coverPreviewUrl: string | null;
  coverSource: CoverSource;
  title: string;
  author: string;
  category: BookCategory;
  language: string;
  description: string;
  pages: string;
  fileHash: string;
  analysisStatus: "pending" | "analyzing" | "ready" | "error";
  duplicateReason?: string;
  uploadStatus: "idle" | "uploading" | "uploaded" | "failed";
  errorMessage?: string;
  warnings: string[];
}

interface BulkBookItemCardProps {
  index: number;
  item: BulkBookQueueItem;
  disabled: boolean;
  onChange: (id: string, patch: Partial<BulkBookQueueItem>) => void;
  onReplaceCover: (id: string, file: File) => void;
  onRemove: (id: string) => void;
  onReanalyze: (id: string) => void;
}

const BulkBookItemCard = ({
  index,
  item,
  disabled,
  onChange,
  onReplaceCover,
  onRemove,
  onReanalyze,
}: BulkBookItemCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const isAnalyzing = item.analysisStatus === "pending" || item.analysisStatus === "analyzing";
  const isUploading = item.uploadStatus === "uploading";
  const isUploaded = item.uploadStatus === "uploaded";
  const hasDuplicate = Boolean(item.duplicateReason);
  const hasError =
    item.analysisStatus === "error" || item.uploadStatus === "failed";

  return (
    <div
      data-testid={`bulk-book-card-${index}`}
      className="rounded-xl border bg-card text-card-foreground p-3 sm:p-4 transition-colors"
    >
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        {/* Cover Thumbnail */}
        <div className="flex items-start gap-3 shrink-0">
          <button
            type="button"
            disabled={disabled || isUploading || isUploaded}
            onClick={() => coverInputRef.current?.click()}
            aria-label={`Change cover for ${item.title || item.bookFile.name}`}
            className="relative w-16 h-24 sm:w-20 sm:h-28 rounded-lg border overflow-hidden bg-muted/40 flex items-center justify-center shrink-0 group cursor-pointer disabled:cursor-default"
          >
            {item.coverPreviewUrl ? (
              <img
                src={item.coverPreviewUrl}
                alt={`${item.title || item.bookFile.name} cover`}
                className="w-full h-full object-cover"
              />
            ) : (
              <ImagePlus className="w-5 h-5 text-muted-foreground" />
            )}
            {!disabled && !isUploaded && (
              <span className="absolute inset-x-0 bottom-0 bg-black/65 text-[10px] text-white py-0.5 text-center opacity-0 group-hover:opacity-100 transition-opacity">
                Change
              </span>
            )}
          </button>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onReplaceCover(item.id, file);
              e.target.value = "";
            }}
          />

          {/* Mobile quick header */}
          <div className="flex-1 min-w-0 sm:hidden">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Book #{index + 1} • {(item.bookFile.size / 1024 / 1024).toFixed(2)} MB
              </span>
              {!isUploading && !isUploaded && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={`Remove ${item.title || item.bookFile.name}`}
                  onClick={() => onRemove(item.id)}
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{item.bookFile.name}</p>
            <div className="mt-1.5">
              <StatusIndicator
                isAnalyzing={isAnalyzing}
                isUploading={isUploading}
                isUploaded={isUploaded}
                hasDuplicate={hasDuplicate}
                hasError={hasError}
                errorText={item.duplicateReason || item.errorMessage}
              />
            </div>
          </div>
        </div>

        {/* Fields & Status */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Desktop header row */}
          <div className="hidden sm:flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold text-muted-foreground shrink-0">
                #{index + 1}
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {item.bookFile.name} ({(item.bookFile.size / 1024 / 1024).toFixed(2)} MB)
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <StatusIndicator
                isAnalyzing={isAnalyzing}
                isUploading={isUploading}
                isUploaded={isUploaded}
                hasDuplicate={hasDuplicate}
                hasError={hasError}
                errorText={item.duplicateReason || item.errorMessage}
              />
              {!isAnalyzing && !isUploading && !isUploaded && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={`Re-detect metadata for ${item.title || item.bookFile.name}`}
                  onClick={() => onReanalyze(item.id)}
                  className="h-7 w-7 text-muted-foreground hover:text-primary"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
              )}
              {!isUploading && !isUploaded && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={`Remove ${item.title || item.bookFile.name}`}
                  onClick={() => onRemove(item.id)}
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>

          {hasDuplicate && (
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-1.5">
              {item.duplicateReason}
            </p>
          )}
          {hasError && item.errorMessage && !hasDuplicate && (
            <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-2.5 py-1.5">
              {item.errorMessage}
            </p>
          )}

          {/* Core Auto-Detected Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div>
              <Label htmlFor={`bulk-title-${item.id}`} className="text-xs text-muted-foreground">
                Title *
              </Label>
              <Input
                id={`bulk-title-${item.id}`}
                value={item.title}
                disabled={disabled || isUploading || isUploaded}
                onChange={(e) => onChange(item.id, { title: e.target.value })}
                placeholder="Book title"
                className="mt-1 h-9 text-sm"
              />
            </div>

            <div>
              <Label htmlFor={`bulk-author-${item.id}`} className="text-xs text-muted-foreground">
                Author *
              </Label>
              <Input
                id={`bulk-author-${item.id}`}
                value={item.author}
                disabled={disabled || isUploading || isUploaded}
                onChange={(e) => onChange(item.id, { author: e.target.value })}
                placeholder="Author name"
                className="mt-1 h-9 text-sm"
              />
            </div>

            <div>
              <Label htmlFor={`bulk-category-${item.id}`} className="text-xs text-muted-foreground">
                Category
              </Label>
              <Select
                value={item.category}
                disabled={disabled || isUploading || isUploaded}
                onValueChange={(val) => onChange(item.id, { category: val as BookCategory })}
              >
                <SelectTrigger id={`bulk-category-${item.id}`} className="mt-1 h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[120] max-h-[240px]">
                  {BOOK_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-[1fr_76px] gap-2">
              <div>
                <Label htmlFor={`bulk-lang-${item.id}`} className="text-xs text-muted-foreground">
                  Language
                </Label>
                <Select
                  value={item.language}
                  disabled={disabled || isUploading || isUploaded}
                  onValueChange={(val) => onChange(item.id, { language: val })}
                >
                  <SelectTrigger id={`bulk-lang-${item.id}`} className="mt-1 h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[120] max-h-[240px]">
                    {WORLD_LANGUAGES.map((lang, idx) => (
                      <SelectItem key={`${lang}-${idx}`} value={lang}>
                        {lang}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor={`bulk-pages-${item.id}`} className="text-xs text-muted-foreground">
                  Pages
                </Label>
                <Input
                  id={`bulk-pages-${item.id}`}
                  type="number"
                  min={1}
                  value={item.pages}
                  disabled={disabled || isUploading || isUploaded}
                  onChange={(e) => onChange(item.id, { pages: e.target.value })}
                  placeholder="Pages"
                  className="mt-1 h-9 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Toggle Description / Details */}
          <div className="flex items-center justify-between pt-0.5">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
            >
              {expanded ? (
                <>
                  Hide description <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  Edit description {item.description ? "(auto-detected)" : ""}{" "}
                  <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </button>
            {item.warnings.length > 0 && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400 truncate max-w-[260px]">
                {item.warnings[0]}
              </span>
            )}
          </div>

          {expanded && (
            <div>
              <Label htmlFor={`bulk-desc-${item.id}`} className="text-xs text-muted-foreground">
                Description
              </Label>
              <Textarea
                id={`bulk-desc-${item.id}`}
                value={item.description}
                disabled={disabled || isUploading || isUploaded}
                onChange={(e) => onChange(item.id, { description: e.target.value })}
                rows={3}
                placeholder="Book description"
                className="mt-1 text-sm"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function StatusIndicator({
  isAnalyzing,
  isUploading,
  isUploaded,
  hasDuplicate,
  hasError,
  errorText,
}: {
  isAnalyzing: boolean;
  isUploading: boolean;
  isUploaded: boolean;
  hasDuplicate: boolean;
  hasError: boolean;
  errorText?: string;
}) {
  if (isAnalyzing) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Detecting...
      </span>
    );
  }
  if (isUploading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Uploading...
      </span>
    );
  }
  if (isUploaded) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Uploaded
      </span>
    );
  }
  if (hasDuplicate) {
    return (
      <span
        title={errorText}
        className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400"
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        Duplicate
      </span>
    );
  }
  if (hasError) {
    return (
      <span
        title={errorText}
        className="inline-flex items-center gap-1 text-xs font-medium text-destructive"
      >
        <XCircle className="w-3.5 h-3.5" />
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="w-3.5 h-3.5" />
      Ready
    </span>
  );
}

export default BulkBookItemCard;
