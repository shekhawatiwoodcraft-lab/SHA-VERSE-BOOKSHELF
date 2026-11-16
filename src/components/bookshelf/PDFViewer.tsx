import { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

import { isDarkReaderTheme, type ReaderTheme } from "@/lib/reader/settings";

export interface PDFOutlineItem {
  title: string;
  pageNumber: number;
  items?: PDFOutlineItem[];
}

interface PDFViewerProps {
  url: string;
  currentPage: number;
  onPageChange: (page: number) => void;
  onTotalPagesChange: (totalPages: number) => void;
  onOutlineExtracted?: (outline: PDFOutlineItem[]) => void;
  onTap?: () => void;
  onScaleChange?: (scale: number) => void;
  fitMode?: "page" | "width";
  readerTheme?: ReaderTheme;
  brightness?: number;
  warmth?: number;
  isDarkMode?: boolean;
  scale?: number;
  className?: string;
}

const getEffectiveContainerWidth = (
  container: HTMLDivElement | null,
  measuredWidth: number
) => {
  if (measuredWidth > 0) return measuredWidth;

  const containerWidth = Math.floor(container?.getBoundingClientRect().width ?? 0);
  if (containerWidth > 0) return containerWidth;

  const parentWidth = Math.floor(
    container?.parentElement?.getBoundingClientRect().width ?? 0
  );
  if (parentWidth > 0) return parentWidth;

  if (typeof window !== "undefined" && window.innerWidth > 0) {
    return Math.max(window.innerWidth - 32, 320);
  }

  return 800;
};

const PDFViewer = ({
  url,
  currentPage,
  onPageChange,
  onTotalPagesChange,
  onOutlineExtracted,
  onTap,
  onScaleChange,
  fitMode = "page",
  readerTheme = "light",
  brightness = 1,
  warmth = 0,
  isDarkMode = false,
  scale = 1.0,
  className,
}: PDFViewerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const touchRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // Update container width on resize using ResizeObserver for reliability
  useEffect(() => {
    if (isLoading) return;

    const container = containerRef.current;
    if (!container) return;

    const measureContainer = () => {
      setContainerWidth(getEffectiveContainerWidth(container, 0));
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.floor(entry.contentRect.width);
        if (width > 0) {
          setContainerWidth(width);
          return;
        }
      }

      measureContainer();
    });

    observer.observe(container);
    const frame = requestAnimationFrame(measureContainer);
    window.addEventListener("resize", measureContainer);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measureContainer);
    };
  }, [isLoading]);

  // Load PDF document
  useEffect(() => {
    let isMounted = true;

    const loadPDF = async () => {
      try {
        setIsLoading(true);
        setIsPageLoading(false);
        setPdfDoc(null);
        setError(null);
        setRetryCount(0);
        setContainerWidth(0);

        // Use PDF.js native URL loading so the worker streams the file in
        // small HTTP-range chunks instead of buffering the whole file in memory.
        // This prevents WebView freezes on large (>50MB) PDFs on mobile.
        const loadingTask = pdfjsLib.getDocument({
          url,
          cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
          cMapPacked: true,
          // Stream + range requests: chunked progressive load
          disableStream: false,
          disableAutoFetch: true, // only fetch ranges as pages are rendered
          rangeChunkSize: 262144, // 256 KB chunks
          withCredentials: false,
        });

        const pdf = await loadingTask.promise;

        if (!isMounted) return;

        setPdfDoc(pdf);
        onTotalPagesChange(pdf.numPages);

        // Extract outline/TOC
        try {
          const outline = await pdf.getOutline();
          if (outline && onOutlineExtracted) {
            const processedOutline = await processOutline(pdf, outline);
            onOutlineExtracted(processedOutline);
          }
        } catch (outlineError) {
          console.warn("Could not extract PDF outline:", outlineError);
        }

        setIsLoading(false);
      } catch (err) {
        if (!isMounted) return;
        console.error("[PDFViewer] Error loading PDF:", err);
        setError("Failed to load PDF. Please try again.");
        setIsLoading(false);
      }
    };

    loadPDF();

    return () => {
      isMounted = false;
      renderTaskRef.current?.cancel();
    };
  }, [url, onTotalPagesChange, onOutlineExtracted]);

  // Process PDF outline to extract page numbers
  const processOutline = async (
    pdf: pdfjsLib.PDFDocumentProxy,
    outline: any[]
  ): Promise<PDFOutlineItem[]> => {
    const result: PDFOutlineItem[] = [];

    for (const item of outline) {
      let pageNumber = 1;

      try {
        if (item.dest) {
          const dest = typeof item.dest === "string" 
            ? await pdf.getDestination(item.dest) 
            : item.dest;
          
          if (dest && dest[0]) {
            const pageRef = dest[0];
            const pageIndex = await pdf.getPageIndex(pageRef);
            pageNumber = pageIndex + 1;
          }
        }
      } catch (e) {
        console.warn("Could not get page number for outline item:", item.title);
      }

      const outlineItem: PDFOutlineItem = {
        title: item.title,
        pageNumber,
      };

      if (item.items && item.items.length > 0) {
        outlineItem.items = await processOutline(pdf, item.items);
      }

      result.push(outlineItem);
    }

    return result;
  };

  // Render current page
  const renderPage = useCallback(async () => {
    if (isLoading || !pdfDoc || !canvasRef.current) {
      return;
    }

    const effectiveContainerWidth = getEffectiveContainerWidth(
      containerRef.current,
      containerWidth
    );

    try {
      setIsPageLoading(true);
      setError(null);

      // Cancel any existing render task
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page = await pdfDoc.getPage(currentPage);
      const canvas = canvasRef.current;
      if (!canvas) return;

      const context = canvas.getContext("2d");

      if (!context) {
        setError("Failed to render page.");
        return;
      }

      // Calculate scale according to fitMode ("page" fits both width & height; "width" fits width)
      const originalViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(effectiveContainerWidth - 24, 300);
      const containerEl = containerRef.current;
      const availableHeight = containerEl ? Math.max(containerEl.clientHeight - 24, 240) : window.innerHeight - 120;
      const scaleByWidth = availableWidth / originalViewport.width;
      const scaleByHeight = availableHeight / originalViewport.height;
      const fitScale = fitMode === "width" ? scaleByWidth : Math.min(scaleByWidth, scaleByHeight);
      const responsiveScale = Math.max(0.1, fitScale) * scale;
      const viewport = page.getViewport({ scale: responsiveScale });

      // Set canvas dimensions
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = viewport.width * pixelRatio;
      canvas.height = viewport.height * pixelRatio;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.scale(pixelRatio, pixelRatio);

      // Render page
      const renderContext = {
        canvasContext: context,
        viewport: viewport,
        canvas: canvas,
      };

      renderTaskRef.current = page.render(renderContext);
      await renderTaskRef.current.promise;
      setError(null);
    } catch (err: any) {
      if (err?.name !== "RenderingCancelledException") {
        console.error("[PDFViewer] Error rendering page:", err);
        setError("Failed to render page.");
      }
    } finally {
      setIsPageLoading(false);
    }
  }, [pdfDoc, currentPage, containerWidth, scale, fitMode, isLoading]);

  // Render page when dependencies change
  useEffect(() => {
    if (isLoading) return;

    const frame = window.requestAnimationFrame(() => {
      void renderPage();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [renderPage, isLoading, retryCount]);

  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel();
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!pdfDoc) return;

      if (e.key === "ArrowLeft" && currentPage > 1) {
        onPageChange(currentPage - 1);
      } else if (e.key === "ArrowRight" && currentPage < pdfDoc.numPages) {
        onPageChange(currentPage + 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pdfDoc, currentPage, onPageChange]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading PDF...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <AlertCircle className="w-12 h-12 text-destructive" />
        <p className="text-destructive">{error}</p>
        {pdfDoc && (
          <Button
            variant="outline"
            onClick={() => {
              setError(null);
              setRetryCount((count) => count + 1);
            }}
          >
            Retry page
          </Button>
        )}
      </div>
    );
  }

  const darkActive = isDarkMode || isDarkReaderTheme(readerTheme);
  const paperFilter = darkActive
    ? "invert(0.92) hue-rotate(180deg)"
    : readerTheme === "sepia"
      ? "sepia(0.28) brightness(0.97)"
      : readerTheme === "warm"
        ? "sepia(0.18) saturate(1.06)"
        : readerTheme === "cream"
          ? "sepia(0.08)"
          : undefined;
  const brightnessOverlayOpacity = Math.max(0, Math.min(0.5, 1 - brightness));
  const warmthOverlayOpacity = Math.max(0, Math.min(0.35, warmth));

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-1 w-full h-full flex-col items-center overflow-auto select-none",
        className
      )}
      onTouchStart={(e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        touchRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
      }}
      onTouchEnd={(e) => {
        const start = touchRef.current;
        touchRef.current = null;
        if (!start || scale > 1.05 || !pdfDoc) return;
        const t = e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          if (dx < 0 && currentPage < pdfDoc.numPages) onPageChange(currentPage + 1);
          else if (dx > 0 && currentPage > 1) onPageChange(currentPage - 1);
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!onScaleChange) return;
        onScaleChange(scale > 1.05 ? 1 : 1.75);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (scale > 1.05 || !pdfDoc) {
          onTap?.();
          return;
        }
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / Math.max(rect.width, 1);
        if (ratio < 0.22 && currentPage > 1) onPageChange(currentPage - 1);
        else if (ratio > 0.78 && currentPage < pdfDoc.numPages) onPageChange(currentPage + 1);
        else onTap?.();
      }}
    >
      <div className="relative my-auto">
        {isPageLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="bg-background rounded-md block transition-[filter] duration-200"
          style={{
            margin: "12px auto",
            filter: paperFilter,
            boxShadow: "0 8px 24px -4px rgba(0,0,0,0.18), 0 2px 8px -2px rgba(0,0,0,0.10)",
          }}
        />
      </div>
      {warmthOverlayOpacity > 0.005 && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-20"
          style={{
            backgroundColor: `rgba(255, 178, 82, ${warmthOverlayOpacity})`,
            mixBlendMode: darkActive ? "screen" : "multiply",
          }}
        />
      )}
      {brightnessOverlayOpacity > 0.005 && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-20"
          style={{
            backgroundColor: `rgba(0, 0, 0, ${brightnessOverlayOpacity})`,
          }}
        />
      )}
    </div>
  );
};

export default PDFViewer;
