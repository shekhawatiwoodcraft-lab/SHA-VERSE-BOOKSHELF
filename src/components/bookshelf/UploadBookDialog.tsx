import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useBooks } from "@/hooks/useBooks";
import { useAppOwner } from "@/hooks/useAppOwner";
import { BOOK_CATEGORIES, type BookCategory } from "@/lib/constants/bookshelf";
import { WORLD_LANGUAGES } from "@/lib/constants/languages";
import { toast } from "sonner";
import { useRegisterBackOverlay } from "@/lib/navigation";
import { analyzeBookFile } from "@/modules/bookshelf/lib/bookAutoDetector";
import {
  MAX_BULK_BOOKS,
  parseTitleAndAuthorFromFilename,
  validateBulkFileSelection,
} from "@/modules/bookshelf/lib/bookMetadataHeuristics";
import {
  resolveEffectiveUploadMode,
  type UploadMode,
} from "@/modules/bookshelf/lib/uploadAccess";
import BulkBookItemCard, { type BulkBookQueueItem } from "./BulkBookItemCard";

interface UploadBookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
}

const UNIQUE_WORLD_LANGUAGES = Array.from(new Set(WORLD_LANGUAGES));

const UploadBookDialog = ({
  open,
  onOpenChange,
  channelId,
}: UploadBookDialogProps) => {
  const { uploadBook } = useBooks();
  const { isAppOwner } = useAppOwner();

  const [requestedMode, setRequestedMode] = useState<UploadMode>("single");
  const mode = resolveEffectiveUploadMode(requestedMode, isAppOwner);

  // ----------------------------- Single Mode State -----------------------------
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [pages, setPages] = useState("");
  const [category, setCategory] = useState<string>(BOOK_CATEGORIES[0]);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [language, setLanguage] = useState<string>("English");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [bookFile, setBookFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [singleFileHash, setSingleFileHash] = useState<string | null>(null);
  const [singleAnalyzing, setSingleAnalyzing] = useState(false);
  const [singleDuplicateWarning, setSingleDuplicateWarning] = useState<string | null>(null);
  const [singleAnalysisNote, setSingleAnalysisNote] = useState<string | null>(null);

  const singleRequestSeqRef = useRef(0);
  const singleTouchedRef = useRef<{
    title?: boolean;
    author?: boolean;
    description?: boolean;
    pages?: boolean;
    category?: boolean;
    language?: boolean;
    cover?: boolean;
  }>({});

  const coverInputRef = useRef<HTMLInputElement>(null);
  const bookInputRef = useRef<HTMLInputElement>(null);

  // ------------------------------ Bulk Mode State ------------------------------
  const [bulkQueue, setBulkQueue] = useState<BulkBookQueueItem[]>([]);
  const [isBulkUploading, setIsBulkUploading] = useState(false);
  const [bulkUploadProgress, setBulkUploadProgress] = useState({ done: 0, total: 0 });
  const [isDraggingBulk, setIsDraggingBulk] = useState(false);
  const [isDraggingSingle, setIsDraggingSingle] = useState(false);
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const bulkQueueRef = useRef<BulkBookQueueItem[]>([]);
  bulkQueueRef.current = bulkQueue;
  const activeAnalysisIdsRef = useRef<Set<string>>(new Set());

  const isBusy = uploadBook.isPending || isBulkUploading;

  const handleClose = useCallback(() => {
    if (isBusy) {
      toast.info("Upload is in progress — please wait for it to finish.");
      return;
    }
    onOpenChange(false);
  }, [isBusy, onOpenChange]);

  useRegisterBackOverlay(open, "upload-book-dialog", handleClose);

  // If user is not the app owner, lock mode to single and clear any stale bulk queue
  useEffect(() => {
    if (!isAppOwner) {
      if (requestedMode !== "single") {
        setRequestedMode("single");
      }
      if (bulkQueueRef.current.length > 0) {
        for (const item of bulkQueueRef.current) {
          if (item.coverPreviewUrl) URL.revokeObjectURL(item.coverPreviewUrl);
        }
        setBulkQueue([]);
      }
    }
  }, [isAppOwner, requestedMode]);

  // Cleanup blob URLs when component unmounts
  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
      for (const item of bulkQueueRef.current) {
        if (item.coverPreviewUrl) URL.revokeObjectURL(item.coverPreviewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetSingleForm = useCallback(() => {
    singleRequestSeqRef.current += 1;
    singleTouchedRef.current = {};
    setCoverPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setTitle("");
    setAuthor("");
    setDescription("");
    setPages("");
    setCategory(BOOK_CATEGORIES[0]);
    setLanguage("English");
    setCoverFile(null);
    setBookFile(null);
    setSingleFileHash(null);
    setSingleAnalyzing(false);
    setSingleDuplicateWarning(null);
    setSingleAnalysisNote(null);
  }, []);

  // ----------------------------- Single Handlers -----------------------------
  const runSingleAutoDetect = useCallback(async (file: File) => {
    const reqId = ++singleRequestSeqRef.current;
    singleTouchedRef.current = {};
    setBookFile(file);
    setSingleFileHash(null);
    setSingleDuplicateWarning(null);
    setSingleAnalysisNote(null);
    setSingleAnalyzing(true);

    try {
      const result = await analyzeBookFile(file);
      if (reqId !== singleRequestSeqRef.current) {
        if (result.coverPreviewUrl) URL.revokeObjectURL(result.coverPreviewUrl);
        return;
      }

      if (!singleTouchedRef.current.title) setTitle(result.title);
      if (!singleTouchedRef.current.author) setAuthor(result.author);
      if (!singleTouchedRef.current.category) setCategory(result.category);
      if (!singleTouchedRef.current.language) setLanguage(result.language);
      if (!singleTouchedRef.current.description) setDescription(result.description);
      if (!singleTouchedRef.current.pages) setPages(String(result.pages));

      if (!singleTouchedRef.current.cover && result.coverFile && result.coverPreviewUrl) {
        setCoverPreview((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return result.coverPreviewUrl;
        });
        setCoverFile(result.coverFile);
      } else if (result.coverPreviewUrl) {
        URL.revokeObjectURL(result.coverPreviewUrl);
      }

      setSingleFileHash(result.fileHash);

      if (result.duplicate.isDuplicate) {
        const msg =
          result.duplicate.matchType === "file"
            ? "This exact book file already exists in the SHA-VERSE library."
            : `A book titled "${result.duplicate.existingBook?.title}" by ${result.duplicate.existingBook?.author} already exists.`;
        setSingleDuplicateWarning(msg);
      }

      if (result.warnings.length > 0) {
        setSingleAnalysisNote(result.warnings[0]);
      } else {
        setSingleAnalysisNote("Auto-detected cover, title, author, category, language, pages & description.");
      }
    } catch (err) {
      if (reqId !== singleRequestSeqRef.current) return;
      console.error("[UploadBookDialog] Single auto-detect failed:", err);
      const fallback = parseTitleAndAuthorFromFilename(file.name);
      if (!singleTouchedRef.current.title) setTitle(fallback.title);
      if (!singleTouchedRef.current.author) setAuthor(fallback.author || "Unknown Author");
      setSingleAnalysisNote("Could not parse all embedded metadata — please review fields before uploading.");
    } finally {
      if (reqId === singleRequestSeqRef.current) {
        setSingleAnalyzing(false);
      }
    }
  }, []);

  const handleSingleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      singleTouchedRef.current.cover = true;
      setCoverPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      setCoverFile(file);
    }
    e.target.value = "";
  };

  const handleSingleBookFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    if (picked.length > 1) {
      toast.info(
        isAppOwner
          ? "Single upload accepts 1 book. Switch to Bulk Upload for up to 20 books."
          : "You can upload 1 book at a time."
      );
    }
    const validation = validateBulkFileSelection([], [picked[0]], 1);
    if (validation.accepted.length === 0) {
      toast.error(validation.rejectedReasons[0] || "Invalid book file");
      return;
    }
    void runSingleAutoDetect(validation.accepted[0]);
  };

  const handleSingleSubmit = async () => {
    if (!title.trim() || !author.trim() || !channelId) return;
    if (singleDuplicateWarning) {
      toast.error(singleDuplicateWarning);
      return;
    }

    await uploadBook.mutateAsync({
      title: title.trim(),
      author: author.trim(),
      description: description.trim(),
      category,
      language,
      coverFile: coverFile || undefined,
      bookFile: bookFile || undefined,
      pages: pages ? Math.max(1, parseInt(pages, 10) || 1) : undefined,
      channelId,
      precomputedFileHash: singleFileHash || undefined,
    });

    resetSingleForm();
    onOpenChange(false);
  };

  // ------------------------------ Bulk Handlers ------------------------------
  const reconcileQueueDuplicates = useCallback((items: BulkBookQueueItem[]): BulkBookQueueItem[] => {
    const seenHashes = new Map<string, number>();
    const seenTitleAuthor = new Map<string, number>();

    return items.map((item, idx) => {
      if (item.uploadStatus === "uploaded") return item;

      let dupReason = item.duplicateReason;
      // Preserve server-side duplicate reason if already flagged from DB check
      const isServerDup = dupReason && !dupReason.startsWith("Duplicate in queue");

      if (!isServerDup) {
        dupReason = undefined;
        if (item.fileHash) {
          const prevIdx = seenHashes.get(item.fileHash);
          if (prevIdx !== undefined) {
            dupReason = `Duplicate in queue: identical file to Book #${prevIdx + 1}.`;
          } else {
            seenHashes.set(item.fileHash, idx);
          }
        }
        const key = `${item.title.trim().toLowerCase()}::${item.author.trim().toLowerCase()}`;
        if (!dupReason && item.title.trim() && item.author.trim()) {
          const prevIdx = seenTitleAuthor.get(key);
          if (prevIdx !== undefined) {
            dupReason = `Duplicate in queue: same title and author as Book #${prevIdx + 1}.`;
          } else {
            seenTitleAuthor.set(key, idx);
          }
        }
      }

      return dupReason === item.duplicateReason ? item : { ...item, duplicateReason: dupReason };
    });
  }, []);

  const analyzeBulkItemById = useCallback(
    async (id: string, file: File) => {
      activeAnalysisIdsRef.current.add(id);
      setBulkQueue((prev) =>
        prev.map((it) =>
          it.id === id
            ? { ...it, analysisStatus: "analyzing", errorMessage: undefined }
            : it
        )
      );

      try {
        const result = await analyzeBookFile(file);
        // Check item still exists in queue
        const stillExists = bulkQueueRef.current.some((it) => it.id === id);
        if (!stillExists) {
          if (result.coverPreviewUrl) URL.revokeObjectURL(result.coverPreviewUrl);
          return;
        }

        setBulkQueue((prev) => {
          const updated = prev.map((it) => {
            if (it.id !== id) return it;
            if (it.coverPreviewUrl) URL.revokeObjectURL(it.coverPreviewUrl);
            const duplicateReason = result.duplicate.isDuplicate
              ? result.duplicate.matchType === "file"
                ? "Already in SHA-VERSE library (identical file)."
                : `Already in library ("${result.duplicate.existingBook?.title}" by ${result.duplicate.existingBook?.author}).`
              : undefined;

            return {
              ...it,
              title: result.title,
              author: result.author,
              category: result.category,
              language: result.language,
              description: result.description,
              pages: String(result.pages),
              coverFile: result.coverFile,
              coverPreviewUrl: result.coverPreviewUrl,
              coverSource: result.coverSource,
              fileHash: result.fileHash,
              analysisStatus: "ready" as const,
              duplicateReason,
              warnings: result.warnings,
            };
          });
          return reconcileQueueDuplicates(updated);
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to analyze book file";
        setBulkQueue((prev) =>
          prev.map((it) =>
            it.id === id
              ? { ...it, analysisStatus: "error", errorMessage: msg }
              : it
          )
        );
      } finally {
        activeAnalysisIdsRef.current.delete(id);
      }
    },
    [reconcileQueueDuplicates]
  );

  // Bounded worker loop (max 2 concurrent PDF/EPUB analyses so UI stays smooth)
  useEffect(() => {
    const activeCount = activeAnalysisIdsRef.current.size;
    if (activeCount >= 2) return;

    const pendingItems = bulkQueue.filter(
      (it) => it.analysisStatus === "pending" && !activeAnalysisIdsRef.current.has(it.id)
    );
    if (pendingItems.length === 0) return;

    const slots = Math.max(0, 2 - activeCount);
    for (const item of pendingItems.slice(0, slots)) {
      void analyzeBulkItemById(item.id, item.bookFile);
    }
  }, [bulkQueue, analyzeBulkItemById]);

  const handleAddBulkFiles = (files: FileList | File[] | null) => {
    if (!isAppOwner || !files || files.length === 0) return;
    const incoming = Array.from(files);

    const validation = validateBulkFileSelection(
      bulkQueue.map((it) => ({ name: it.bookFile.name, size: it.bookFile.size })),
      incoming,
      MAX_BULK_BOOKS
    );

    if (validation.rejectedReasons.length > 0) {
      toast.warning(validation.rejectedReasons[0]);
    }
    if (validation.accepted.length === 0) return;

    const newItems: BulkBookQueueItem[] = validation.accepted.map((file, idx) => {
      const guess = parseTitleAndAuthorFromFilename(file.name);
      return {
        id: `${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
        bookFile: file,
        coverFile: null,
        coverPreviewUrl: null,
        coverSource: "generated",
        title: guess.title,
        author: guess.author || "",
        category: BOOK_CATEGORIES[0],
        language: "English",
        description: "",
        pages: "",
        fileHash: "",
        analysisStatus: "pending",
        uploadStatus: "idle",
        warnings: [],
      };
    });

    setBulkQueue((prev) => [...prev, ...newItems]);
  };

  const handleBulkItemChange = useCallback(
    (id: string, patch: Partial<BulkBookQueueItem>) => {
      setBulkQueue((prev) => {
        const updated = prev.map((it) =>
          it.id === id
            ? {
                ...it,
                ...patch,
                // If user changed title/author after a failed/duplicate state, clear stale error for recheck
                ...(patch.title !== undefined || patch.author !== undefined
                  ? { uploadStatus: it.uploadStatus === "failed" ? "idle" : it.uploadStatus, errorMessage: undefined }
                  : {}),
              }
            : it
        );
        return reconcileQueueDuplicates(updated);
      });
    },
    [reconcileQueueDuplicates]
  );

  const handleBulkReplaceCover = useCallback((id: string, file: File) => {
    setBulkQueue((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        if (it.coverPreviewUrl) URL.revokeObjectURL(it.coverPreviewUrl);
        return {
          ...it,
          coverFile: file,
          coverPreviewUrl: URL.createObjectURL(file),
          coverSource: "custom",
        };
      })
    );
  }, []);

  const handleBulkRemoveItem = useCallback(
    (id: string) => {
      setBulkQueue((prev) => {
        const target = prev.find((it) => it.id === id);
        if (target?.coverPreviewUrl) URL.revokeObjectURL(target.coverPreviewUrl);
        return reconcileQueueDuplicates(prev.filter((it) => it.id !== id));
      });
    },
    [reconcileQueueDuplicates]
  );

  const handleBulkReanalyze = useCallback((id: string) => {
    setBulkQueue((prev) =>
      prev.map((it) => (it.id === id ? { ...it, analysisStatus: "pending", errorMessage: undefined } : it))
    );
  }, []);

  const handleBulkClearAll = useCallback(() => {
    for (const item of bulkQueueRef.current) {
      if (item.coverPreviewUrl) URL.revokeObjectURL(item.coverPreviewUrl);
    }
    setBulkQueue([]);
  }, []);

  const bulkStats = useMemo(() => {
    const analyzing = bulkQueue.filter(
      (it) => it.analysisStatus === "pending" || it.analysisStatus === "analyzing"
    ).length;
    const uploaded = bulkQueue.filter((it) => it.uploadStatus === "uploaded").length;
    const duplicates = bulkQueue.filter((it) => Boolean(it.duplicateReason)).length;
    const readyToUpload = bulkQueue.filter(
      (it) =>
        it.analysisStatus === "ready" &&
        it.uploadStatus !== "uploaded" &&
        !it.duplicateReason &&
        it.title.trim().length > 0 &&
        it.author.trim().length > 0
    );
    const missingFields = bulkQueue.filter(
      (it) =>
        it.analysisStatus === "ready" &&
        it.uploadStatus !== "uploaded" &&
        !it.duplicateReason &&
        (!it.title.trim() || !it.author.trim())
    ).length;

    return {
      total: bulkQueue.length,
      analyzing,
      uploaded,
      duplicates,
      readyCount: readyToUpload.length,
      missingFields,
      readyItems: readyToUpload,
    };
  }, [bulkQueue]);

  const handleBulkSubmit = async () => {
    if (!isAppOwner || !channelId || bulkStats.readyCount === 0 || bulkStats.analyzing > 0) return;

    const reconciled = reconcileQueueDuplicates(bulkQueue);
    setBulkQueue(reconciled);

    const uploadTargets = reconciled.filter(
      (it) =>
        it.analysisStatus === "ready" &&
        it.uploadStatus !== "uploaded" &&
        !it.duplicateReason &&
        it.title.trim().length > 0 &&
        it.author.trim().length > 0
    );

    if (uploadTargets.length === 0) {
      toast.error("No valid non-duplicate books ready to upload.");
      return;
    }

    setIsBulkUploading(true);
    setBulkUploadProgress({ done: 0, total: uploadTargets.length });

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < uploadTargets.length; i++) {
      const item = uploadTargets[i];
      setBulkQueue((prev) =>
        prev.map((it) =>
          it.id === item.id ? { ...it, uploadStatus: "uploading", errorMessage: undefined } : it
        )
      );

      try {
        await uploadBook.mutateAsync({
          title: item.title.trim(),
          author: item.author.trim(),
          description: item.description.trim(),
          category: item.category,
          language: item.language,
          coverFile: item.coverFile || undefined,
          bookFile: item.bookFile,
          pages: item.pages ? Math.max(1, parseInt(item.pages, 10) || 1) : undefined,
          channelId,
          silent: true,
          precomputedFileHash: item.fileHash || undefined,
        });

        successCount += 1;
        setBulkQueue((prev) =>
          prev.map((it) =>
            it.id === item.id ? { ...it, uploadStatus: "uploaded", errorMessage: undefined } : it
          )
        );
      } catch (err) {
        failedCount += 1;
        const msg = err instanceof Error ? err.message : "Upload failed";
        setBulkQueue((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  uploadStatus: "failed",
                  errorMessage: msg,
                  duplicateReason: msg.toLowerCase().includes("already exists") ? msg : it.duplicateReason,
                }
              : it
          )
        );
      }

      setBulkUploadProgress({ done: i + 1, total: uploadTargets.length });
    }

    setIsBulkUploading(false);

    if (failedCount === 0 && successCount > 0) {
      toast.success(
        `${successCount} ${successCount === 1 ? "book" : "books"} uploaded successfully!`
      );
      if (bulkStats.duplicates === 0 && bulkStats.missingFields === 0) {
        handleBulkClearAll();
        onOpenChange(false);
      }
    } else if (successCount > 0) {
      toast.warning(`${successCount} uploaded, ${failedCount} failed. Review flagged items below.`);
    } else {
      toast.error("Bulk upload failed. Please check the flagged errors.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}>
      <DialogContent className="!fixed !inset-0 !left-0 !top-0 !translate-x-0 !translate-y-0 !w-full !h-[100dvh] !max-w-none !max-h-none !rounded-none !border-0 !p-0 flex flex-col gap-0 overflow-hidden bg-background [&>button.absolute]:hidden">
        {/* Sticky Full-Screen Header (clears Android/iOS status bar via safe-area-inset-top) */}
        <DialogHeader
          className="px-4 sm:px-8 pb-3.5 border-b bg-background/95 backdrop-blur shrink-0 text-left"
          style={{ paddingTop: "calc(0.875rem + env(safe-area-inset-top, 0px))" }}
        >
          <div className="max-w-5xl mx-auto w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center justify-between gap-3 w-full sm:w-auto">
              <DialogTitle className="text-lg sm:text-xl font-bold">
                {isAppOwner ? "Upload Books" : "Upload Book"}
              </DialogTitle>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isBusy}
                  aria-label="Close"
                  className="sm:hidden h-9 w-9 shrink-0 rounded-full"
                >
                  <X className="h-4 w-4" />
                </Button>
              </DialogClose>
            </div>

            <div className="flex items-center gap-3 self-start sm:self-auto">
              {/* Single vs Bulk Segmented Toggle — App Owner Only */}
              {isAppOwner && (
                <div
                  role="tablist"
                  aria-label="Upload mode"
                  className="inline-flex rounded-lg border bg-muted/50 p-1"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === "single"}
                    disabled={isBusy}
                    onClick={() => setRequestedMode("single")}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors inline-flex items-center gap-1.5",
                      mode === "single"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Single (1 Book)
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === "bulk"}
                    disabled={isBusy}
                    onClick={() => setRequestedMode("bulk")}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors inline-flex items-center gap-1.5",
                      mode === "bulk"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Bulk (Max {MAX_BULK_BOOKS})
                  </button>
                </div>
              )}
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isBusy}
                  aria-label="Close"
                  className="hidden sm:inline-flex h-9 w-9 shrink-0 rounded-full"
                >
                  <X className="h-4 w-4" />
                </Button>
              </DialogClose>
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-6">
          {mode === "single" ? (
            <div className="max-w-5xl mx-auto w-full space-y-5">
              {/* Auto-detect status banner */}
              {singleAnalyzing && (
                <div className="flex items-center gap-2.5 rounded-lg border border-primary/25 bg-primary/5 px-3.5 py-2.5 text-sm text-primary">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>
                    Reading book file to auto-detect cover image, title, author, category, language,
                    pages & description...
                  </span>
                </div>
              )}

              {singleDuplicateWarning && (
                <div className="flex items-center gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{singleDuplicateWarning}</span>
                </div>
              )}

              {!singleAnalyzing && singleAnalysisNote && !singleDuplicateWarning && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2 text-xs sm:text-sm text-emerald-700 dark:text-emerald-300">
                  <span>{singleAnalysisNote}</span>
                  {bookFile && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void runSingleAutoDetect(bookFile)}
                      className="h-7 px-2 text-xs shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" />
                      Re-detect
                    </Button>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 lg:gap-8">
                {/* Left Column: Book File (primary trigger for auto-detection) + Cover Image */}
                <div className="space-y-5">
                  <div>
                    <Label>Book File (PDF, EPUB, MOBI, TXT) *</Label>
                    <div
                      onClick={() => !isBusy && bookInputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDraggingSingle(true);
                      }}
                      onDragLeave={() => setIsDraggingSingle(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDraggingSingle(false);
                        if (!isBusy) handleSingleBookFiles(e.dataTransfer.files);
                      }}
                      className={cn(
                        "mt-2 p-4 rounded-xl border-2 border-dashed transition-colors cursor-pointer bg-muted/20",
                        isDraggingSingle
                          ? "border-primary bg-primary/5"
                          : "border-muted-foreground/30 hover:border-primary/50"
                      )}
                    >
                      {bookFile ? (
                        <div className="flex items-center gap-3">
                          <FileText className="w-8 h-8 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{bookFile.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {(bookFile.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isBusy}
                            aria-label="Remove book file"
                            onClick={(e) => {
                              e.stopPropagation();
                              resetSingleForm();
                            }}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="text-center py-2">
                          <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                          <p className="text-sm font-medium text-muted-foreground">
                            Click or drop 1 book file
                          </p>
                          <p className="text-xs text-muted-foreground/75 mt-1">
                            Auto-fills cover & all details
                          </p>
                        </div>
                      )}
                    </div>
                    <input
                      ref={bookInputRef}
                      type="file"
                      accept=".pdf,.epub,.mobi,.txt"
                      className="hidden"
                      onChange={(e) => {
                        handleSingleBookFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </div>

                  <div>
                    <Label>Cover Image (Auto-detected)</Label>
                    <div
                      onClick={() => !isBusy && coverInputRef.current?.click()}
                      className="mt-2 aspect-[2/3] w-[176px] mx-auto lg:mx-0 rounded-xl border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors cursor-pointer flex items-center justify-center overflow-hidden bg-muted/20"
                    >
                      {coverPreview ? (
                        <div className="relative w-full h-full">
                          <img
                            src={coverPreview}
                            alt="Cover preview"
                            className="w-full h-full object-cover"
                          />
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            disabled={isBusy}
                            aria-label="Remove cover image"
                            className="absolute top-2 right-2 h-7 w-7 rounded-full"
                            onClick={(e) => {
                              e.stopPropagation();
                              singleTouchedRef.current.cover = true;
                              URL.revokeObjectURL(coverPreview);
                              setCoverFile(null);
                              setCoverPreview(null);
                            }}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="text-center p-4">
                          <ImageIcon className="w-9 h-9 mx-auto mb-2 text-muted-foreground" />
                          <p className="text-sm font-medium text-muted-foreground">
                            Click to upload cover
                          </p>
                          <p className="text-xs text-muted-foreground/75 mt-1">
                            Auto-extracted from PDF/EPUB
                          </p>
                        </div>
                      )}
                    </div>
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleSingleCoverSelect}
                    />
                  </div>
                </div>

                {/* Right Column: Editable Auto-Detected Fields */}
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="title">Title *</Label>
                      <Input
                        id="title"
                        value={title}
                        disabled={isBusy}
                        onChange={(e) => {
                          singleTouchedRef.current.title = true;
                          setTitle(e.target.value);
                        }}
                        placeholder="Enter book title"
                        className="mt-1.5"
                      />
                    </div>

                    <div>
                      <Label htmlFor="author">Author *</Label>
                      <Input
                        id="author"
                        value={author}
                        disabled={isBusy}
                        onChange={(e) => {
                          singleTouchedRef.current.author = true;
                          setAuthor(e.target.value);
                        }}
                        placeholder="Enter author name"
                        className="mt-1.5"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label>Category *</Label>
                      <Popover open={categoryOpen} onOpenChange={setCategoryOpen} modal={true}>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            role="combobox"
                            aria-label="Category"
                            aria-expanded={categoryOpen}
                            disabled={isBusy}
                            className="w-full justify-between font-normal mt-1.5"
                          >
                            {category}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[--radix-popover-trigger-width] p-0 z-[110]"
                          align="start"
                          onWheel={(e) => e.stopPropagation()}
                          onTouchMove={(e) => e.stopPropagation()}
                        >
                          <Command>
                            <CommandInput placeholder="Search categories..." />
                            <CommandList className="max-h-[240px] overflow-y-auto overscroll-contain">
                              <CommandEmpty>No category found.</CommandEmpty>
                              <CommandGroup>
                                {BOOK_CATEGORIES.map((cat) => (
                                  <CommandItem
                                    key={cat}
                                    value={cat}
                                    onSelect={() => {
                                      singleTouchedRef.current.category = true;
                                      setCategory(cat);
                                      setCategoryOpen(false);
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        category === cat ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    {cat}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div>
                      <Label>Language *</Label>
                      <Popover open={languageOpen} onOpenChange={setLanguageOpen} modal={true}>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            role="combobox"
                            aria-label="Language"
                            aria-expanded={languageOpen}
                            disabled={isBusy}
                            className="w-full justify-between font-normal mt-1.5"
                          >
                            {language}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[--radix-popover-trigger-width] p-0 z-[110]"
                          align="start"
                          onWheel={(e) => e.stopPropagation()}
                          onTouchMove={(e) => e.stopPropagation()}
                        >
                          <Command>
                            <CommandInput placeholder="Search languages..." />
                            <CommandList className="max-h-[240px] overflow-y-auto overscroll-contain">
                              <CommandEmpty>No language found.</CommandEmpty>
                              <CommandGroup>
                                {UNIQUE_WORLD_LANGUAGES.map((lang) => (
                                  <CommandItem
                                    key={lang}
                                    value={lang}
                                    onSelect={() => {
                                      singleTouchedRef.current.language = true;
                                      setLanguage(lang);
                                      setLanguageOpen(false);
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        language === lang ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    {lang}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={description}
                      disabled={isBusy}
                      onChange={(e) => {
                        singleTouchedRef.current.description = true;
                        setDescription(e.target.value);
                      }}
                      placeholder="Auto-detected book description (editable)"
                      rows={5}
                      className="mt-1.5"
                    />
                  </div>

                  <div className="max-w-xs">
                    <Label htmlFor="pages">Number of Pages</Label>
                    <Input
                      id="pages"
                      type="number"
                      min={1}
                      value={pages}
                      disabled={isBusy}
                      onChange={(e) => {
                        singleTouchedRef.current.pages = true;
                        setPages(e.target.value);
                      }}
                      placeholder="e.g., 250"
                      className="mt-1.5"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ------------------------------ Bulk Mode UI ------------------------------ */
            <div className="max-w-5xl mx-auto w-full space-y-5">
              {/* Bulk Dropzone */}
              <div
                onClick={() =>
                  !isBusy && bulkQueue.length < MAX_BULK_BOOKS && bulkInputRef.current?.click()
                }
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingBulk(true);
                }}
                onDragLeave={() => setIsDraggingBulk(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingBulk(false);
                  if (!isBusy) handleAddBulkFiles(e.dataTransfer.files);
                }}
                className={cn(
                  "rounded-xl border-2 border-dashed p-5 sm:p-6 transition-colors text-center",
                  bulkQueue.length >= MAX_BULK_BOOKS || isBusy
                    ? "border-muted bg-muted/20 cursor-not-allowed opacity-70"
                    : isDraggingBulk
                      ? "border-primary bg-primary/5 cursor-pointer"
                      : "border-muted-foreground/30 hover:border-primary/50 bg-muted/20 cursor-pointer"
                )}
              >
                <Upload className="w-8 h-8 mx-auto mb-2 text-primary" />
                <p className="text-sm sm:text-base font-semibold">
                  {bulkQueue.length >= MAX_BULK_BOOKS
                    ? `Queue full (${MAX_BULK_BOOKS}/${MAX_BULK_BOOKS} books)`
                    : "Drop up to 20 books here or click to select files"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Supports PDF, EPUB, MOBI, TXT (max 100 MB each) • Cover, Title, Author, Category,
                  Language, Pages & Description auto-detected for every book
                </p>
                <input
                  ref={bulkInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.epub,.mobi,.txt"
                  className="hidden"
                  onChange={(e) => {
                    handleAddBulkFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>

              {/* Queue Summary & Progress Bar */}
              {bulkQueue.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold">
                        Queued: {bulkStats.total}/{MAX_BULK_BOOKS}
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        Ready: {bulkStats.readyCount}
                      </span>
                      {bulkStats.analyzing > 0 && (
                        <span className="text-primary inline-flex items-center gap-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Detecting {bulkStats.analyzing}...
                        </span>
                      )}
                      {bulkStats.duplicates > 0 && (
                        <span className="text-amber-600 dark:text-amber-400">
                          Duplicates skipped: {bulkStats.duplicates}
                        </span>
                      )}
                      {bulkStats.uploaded > 0 && (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          Uploaded: {bulkStats.uploaded}
                        </span>
                      )}
                    </div>

                    {!isBusy && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleBulkClearAll}
                        className="h-7 text-xs text-muted-foreground hover:text-destructive"
                      >
                        Clear queue
                      </Button>
                    )}
                  </div>

                  {isBulkUploading && bulkUploadProgress.total > 0 && (
                    <div className="space-y-1">
                      <Progress
                        value={(bulkUploadProgress.done / bulkUploadProgress.total) * 100}
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground text-right">
                        Uploading {bulkUploadProgress.done} of {bulkUploadProgress.total} books...
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Queue List */}
              {bulkQueue.length > 0 ? (
                <div className="space-y-3">
                  {bulkQueue.map((item, idx) => (
                    <BulkBookItemCard
                      key={item.id}
                      index={idx}
                      item={item}
                      disabled={isBulkUploading}
                      onChange={handleBulkItemChange}
                      onReplaceCover={handleBulkReplaceCover}
                      onRemove={handleBulkRemoveItem}
                      onReanalyze={handleBulkReanalyze}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border bg-muted/10 p-8 text-center text-sm text-muted-foreground">
                  Select multiple book files (1 to {MAX_BULK_BOOKS}) above to inspect and upload
                  them together in one batch.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky Bottom Footer */}
        <div
          className="px-4 sm:px-8 pt-3.5 border-t bg-background/95 backdrop-blur shrink-0"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="max-w-5xl mx-auto w-full flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              className="flex-1 sm:flex-none sm:min-w-[140px] h-11"
              onClick={handleClose}
            >
              Cancel
            </Button>

            {mode === "single" ? (
              <Button
                type="button"
                className="flex-1 sm:flex-none sm:min-w-[190px] h-11"
                onClick={handleSingleSubmit}
                disabled={
                  !title.trim() ||
                  !author.trim() ||
                  singleAnalyzing ||
                  Boolean(singleDuplicateWarning) ||
                  uploadBook.isPending
                }
              >
                {uploadBook.isPending
                  ? "Uploading..."
                  : singleAnalyzing
                    ? "Analyzing Book..."
                    : "Upload Book"}
              </Button>
            ) : (
              <Button
                type="button"
                className="flex-1 sm:flex-none sm:min-w-[220px] h-11"
                onClick={handleBulkSubmit}
                disabled={
                  bulkStats.readyCount === 0 ||
                  bulkStats.analyzing > 0 ||
                  isBulkUploading
                }
              >
                {isBulkUploading
                  ? `Uploading (${bulkUploadProgress.done}/${bulkUploadProgress.total})...`
                  : bulkStats.analyzing > 0
                    ? `Detecting (${bulkStats.analyzing})...`
                    : `Upload ${bulkStats.readyCount} ${
                        bulkStats.readyCount === 1 ? "Book" : "Books"
                      }`}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UploadBookDialog;
