import { useEffect, useRef, useState, useCallback } from "react";
import ePub, { Book, Rendition } from "epubjs";
import { Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_READER_SETTINGS,
  READER_FONT_STACKS,
  READER_THEMES,
  type ReaderSettings,
} from "@/lib/reader/settings";

interface EPUBViewerProps {
  url: string;
  initialCfi?: string;
  onLocationChange?: (cfi: string, page: number, totalPages: number, href?: string) => void;
  onTocExtracted?: (toc: TocItem[]) => void;
  onTap?: () => void;
  settings?: ReaderSettings;
  theme?: "light" | "dark" | "sepia";
  fontSize?: number;
  className?: string;
}

export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}

const EPUB_MARGIN_PADDING = [12, 24, 40, 56];

function buildEpubStyles(settings: ReaderSettings): Record<string, string> {
  const palette = READER_THEMES[settings.theme] ?? READER_THEMES.light;
  const padX = EPUB_MARGIN_PADDING[settings.margin] ?? 24;
  const fontStack = READER_FONT_STACKS[settings.font] ?? READER_FONT_STACKS.serif;
  const fontRule = settings.font === "publisher" ? "" : `font-family: ${fontStack} !important;`;
  const indentRule = settings.firstLineIndent ? "text-indent: 1.4em !important;" : "text-indent: 0 !important;";
  const alignRule = settings.justify
    ? "text-align: justify !important; text-justify: inter-word !important; hyphens: auto !important; -webkit-hyphens: auto !important;"
    : "text-align: left !important;";
  const spacingRule = settings.looseSpacing
    ? "letter-spacing: 0.02em !important; word-spacing: 0.1em !important;"
    : "";

  return {
    "html, body": `margin: 0 !important; padding: 0 !important; max-width: 100% !important; overflow-x: hidden !important; background-color: ${palette.bg} !important; color: ${palette.text} !important;`,
    "*": "box-sizing: border-box !important;",
    "[style*='position: fixed'], [style*='position:fixed']": "position: static !important;",
    "img, svg, video": "max-width: 100% !important; height: auto !important;",
    body: `background-color: ${palette.bg} !important; color: ${palette.text} !important; ${fontRule} padding: 16px clamp(12px, 4vw, ${padX}px) !important; -webkit-font-smoothing: antialiased !important; text-rendering: optimizeLegibility !important;`,
    p: `${fontRule} line-height: ${settings.lineHeight} !important; margin: 0 0 ${settings.paragraphSpacing}em 0 !important; ${alignRule} ${spacingRule} overflow-wrap: break-word !important; orphans: 2; widows: 2;`,
    "p + p": indentRule,
    "h1, h2, h3, h4, h5, h6": `${fontRule} color: ${palette.text} !important; line-height: 1.3 !important; margin: 1.15em 0 0.55em !important;`,
    a: `color: ${palette.accent} !important;`,
  };
}

const EPUBViewer = ({
  url,
  initialCfi,
  onLocationChange,
  onTocExtracted,
  onTap,
  settings,
  theme = "light",
  fontSize = 18,
  className,
}: EPUBViewerProps) => {
  const effectiveSettings: ReaderSettings = settings ?? {
    ...DEFAULT_READER_SETTINGS,
    theme,
    fontSize,
  };

  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const settingsRef = useRef(effectiveSettings);
  settingsRef.current = effectiveSettings;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitionPulse, setTransitionPulse] = useState(false);

  const triggerTurnEffect = useCallback(() => {
    const mode = settingsRef.current.pageTransition;
    if (!mode || mode === "none") return;
    setTransitionPulse(true);
    window.setTimeout(() => setTransitionPulse(false), 170);
  }, []);

  // Initialize book
  useEffect(() => {
    if (!viewerRef.current) return;

    let isMounted = true;
    const container = viewerRef.current;

    const initBook = async () => {
      try {
        setIsLoading(true);
        setError(null);

        if (bookRef.current) {
          bookRef.current.destroy();
        }

        const book = ePub(url);
        bookRef.current = book;

        const currentSettings = settingsRef.current;
        const rendition = book.renderTo(container, {
          width: "100%",
          height: "100%",
          spread: currentSettings.pageSpread === "single" ? "none" : "auto",
          flow: currentSettings.readingMode === "scroll" ? "scrolled-doc" : "paginated",
        });

        renditionRef.current = rendition;

        rendition.themes.register("shaverse-active", buildEpubStyles(currentSettings));
        rendition.themes.select("shaverse-active");
        rendition.themes.fontSize(`${currentSettings.fontSize}px`);

        // Attach swipe, tap-zone, and keyboard inside EPUB iframe contents
        rendition.hooks.content.register((contents: any) => {
          const doc = contents?.document as Document | undefined;
          if (!doc) return;

          let touchStart: { x: number; y: number; time: number } | null = null;
          doc.addEventListener(
            "touchstart",
            (e: TouchEvent) => {
              const t = e.touches[0];
              if (t) touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
            },
            { passive: true }
          );
          doc.addEventListener(
            "touchend",
            (e: TouchEvent) => {
              const start = touchStart;
              touchStart = null;
              if (!start) return;
              const t = e.changedTouches[0];
              if (!t) return;
              const dx = t.clientX - start.x;
              const dy = t.clientY - start.y;
              const sel = doc.getSelection()?.toString().trim();
              if (sel) return;
              if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
                triggerTurnEffect();
                if (dx < 0) void rendition.next();
                else void rendition.prev();
              } else if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && Date.now() - start.time < 400) {
                const width = Math.max(doc.documentElement.clientWidth || window.innerWidth, 1);
                const ratio = t.clientX / width;
                if (ratio < 0.25) {
                  triggerTurnEffect();
                  void rendition.prev();
                } else if (ratio > 0.75) {
                  triggerTurnEffect();
                  void rendition.next();
                } else {
                  onTapRef.current?.();
                }
              }
            },
            { passive: true }
          );

          doc.addEventListener("click", (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest("a")) return;
            const sel = doc.getSelection()?.toString().trim();
            if (sel) return;
            const width = Math.max(doc.documentElement.clientWidth || window.innerWidth, 1);
            const ratio = e.clientX / width;
            if (ratio < 0.22) {
              triggerTurnEffect();
              void rendition.prev();
            } else if (ratio > 0.78) {
              triggerTurnEffect();
              void rendition.next();
            } else {
              onTapRef.current?.();
            }
          });
        });

        if (initialCfi) {
          await rendition.display(initialCfi);
        } else {
          await rendition.display();
        }

        await book.locations.generate(1024);

        const navigation = await book.loaded.navigation;
        if (navigation?.toc && onTocExtracted) {
          const mapToc = (items: any[]): TocItem[] =>
            items.map((item: any) => ({
              label: item.label?.trim() || "Untitled",
              href: item.href,
              subitems: item.subitems ? mapToc(item.subitems) : undefined,
            }));
          onTocExtracted(mapToc(navigation.toc));
        }

        rendition.on("relocated", (location: any) => {
          if (!isMounted) return;
          const cfi = location.start.cfi;
          const loc = book.locations.locationFromCfi(cfi);
          const currentPage = typeof loc === "number" ? loc : 0;
          const totalPages =
            (book.locations as any).total || (book.locations as any)._locations?.length || 1;
          onLocationChange?.(cfi, currentPage + 1, totalPages, location.start?.href);
        });

        if (isMounted) setIsLoading(false);
      } catch (err) {
        console.error("[EPUBViewer] Error:", err);
        if (isMounted) {
          setError("Failed to load EPUB. The file may be corrupted.");
          setIsLoading(false);
        }
      }
    };

    void initBook();

    return () => {
      isMounted = false;
      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
        renditionRef.current = null;
      }
    };
    // Only re-init on URL change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Apply dynamic theme, typography, flow & spread changes cleanly without reloading book
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    try {
      rendition.themes.register("shaverse-active", buildEpubStyles(effectiveSettings));
      rendition.themes.select("shaverse-active");
      rendition.themes.fontSize(`${effectiveSettings.fontSize}px`);
      rendition.spread(effectiveSettings.pageSpread === "single" ? "none" : "auto");
      rendition.flow(effectiveSettings.readingMode === "scroll" ? "scrolled-doc" : "paginated");
    } catch {
      // Ignore updates before rendition mounts contents
    }
  }, [
    effectiveSettings.theme,
    effectiveSettings.font,
    effectiveSettings.fontSize,
    effectiveSettings.lineHeight,
    effectiveSettings.margin,
    effectiveSettings.paragraphSpacing,
    effectiveSettings.firstLineIndent,
    effectiveSettings.justify,
    effectiveSettings.looseSpacing,
    effectiveSettings.pageSpread,
    effectiveSettings.readingMode,
  ]);

  // Reflow EPUB pages seamlessly when viewport or controls resize
  useEffect(() => {
    const container = viewerRef.current;
    if (!container) return;
    let raf = 0;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 10 || rect.height < 10) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          renditionRef.current?.resize(Math.floor(rect.width), Math.floor(rect.height));
        } catch {
          // Ignore resize before rendition is ready
        }
      });
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  const nextPage = useCallback(() => {
    triggerTurnEffect();
    renditionRef.current?.next();
  }, [triggerTurnEffect]);

  const prevPage = useCallback(() => {
    triggerTurnEffect();
    renditionRef.current?.prev();
  }, [triggerTurnEffect]);

  const goToHref = useCallback((href: string) => {
    renditionRef.current?.display(href);
  }, []);

  const goToCfi = useCallback((cfi: string) => {
    renditionRef.current?.display(cfi);
  }, []);

  useEffect(() => {
    if (viewerRef.current) {
      (viewerRef.current as any).__epubMethods = {
        nextPage,
        prevPage,
        goToHref,
        goToCfi,
      };
    }
  }, [nextPage, prevPage, goToHref, goToCfi]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <AlertCircle className="w-12 h-12 text-destructive" />
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  const palette = READER_THEMES[effectiveSettings.theme] ?? READER_THEMES.light;
  const brightnessOverlayOpacity = Math.max(0, Math.min(0.5, 1 - (effectiveSettings.brightness ?? 1)));
  const warmthOverlayOpacity = Math.max(0, Math.min(0.35, effectiveSettings.warmth ?? 0));

  return (
    <div className={cn("relative w-full h-full min-h-[300px]", className)}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Loading EPUB...</p>
          </div>
        </div>
      )}
      <div
        ref={viewerRef}
        className="w-full h-full transition-opacity duration-150"
        style={{
          backgroundColor: palette.bg,
          opacity: transitionPulse ? 0.72 : 1,
        }}
      />
      {warmthOverlayOpacity > 0.005 && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-20"
          style={{
            backgroundColor: `rgba(255, 178, 82, ${warmthOverlayOpacity})`,
            mixBlendMode: palette.dark ? "screen" : "multiply",
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

export default EPUBViewer;

