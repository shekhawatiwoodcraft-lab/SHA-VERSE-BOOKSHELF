/**
 * Reader typography + theme settings (Reader Mode & EPUB & PDF).
 * Persisted locally so the reading experience is identical across sessions.
 */
import { useCallback, useEffect, useState } from "react";

export type ReaderTheme = "light" | "warm" | "cream" | "sepia" | "dark" | "black";
export type ReaderFont = "publisher" | "serif" | "literata" | "sans" | "dyslexic";
/** "paged" = horizontal, one screen per page. "scroll" = continuous vertical. */
export type ReadingMode = "paged" | "scroll";
/** "auto" = 2-page book spread on wide tablet/desktop landscape; "single" = 1 page. */
export type PageSpreadMode = "auto" | "single";
export type PageTransitionStyle = "slide" | "curl" | "fade" | "none";

export interface ReaderSettings {
  theme: ReaderTheme;
  font: ReaderFont;
  fontSize: number;
  lineHeight: number;
  /** 0 = narrow, 3 = wide side margins. */
  margin: number;
  paragraphSpacing: number;
  firstLineIndent: boolean;
  justify: boolean;
  /** Extra letter/word spacing for accessibility. */
  looseSpacing: boolean;
  /** Horizontal paged reading vs continuous scrolling. */
  readingMode: ReadingMode;
  /** Single page vs responsive two-page spread on wide screens. */
  pageSpread: PageSpreadMode;
  /** Page-turn visual transition style. */
  pageTransition: PageTransitionStyle;
  /** Backward-compatible boolean flag synced with pageTransition. */
  pageAnimation: boolean;
  /** Software surface brightness multiplier (0.5 - 1.0). */
  brightness: number;
  /** Subtle warm eye-comfort paper tint overlay (0 - 0.35). */
  warmth: number;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: "light",
  font: "serif",
  fontSize: 19,
  lineHeight: 1.65,
  margin: 1,
  paragraphSpacing: 0.9,
  firstLineIndent: true,
  justify: false,
  looseSpacing: false,
  readingMode: "paged",
  pageSpread: "auto",
  pageTransition: "slide",
  pageAnimation: true,
  brightness: 1,
  warmth: 0,
};

const STORAGE_KEY = "shaverse:reader-settings:v1";

export const READER_THEMES: Record<
  ReaderTheme,
  { bg: string; text: string; muted: string; accent: string; chromeBg: string; border: string; label: string; dark: boolean }
> = {
  light: {
    bg: "#ffffff",
    text: "#16181d",
    muted: "#6b7280",
    accent: "#1d4ed8",
    chromeBg: "rgba(255, 255, 255, 0.95)",
    border: "#e5e7eb",
    label: "Original",
    dark: false,
  },
  warm: {
    bg: "#fbf3e0",
    text: "#362b1c",
    muted: "#7a674d",
    accent: "#9a5b13",
    chromeBg: "rgba(247, 236, 211, 0.95)",
    border: "#e7d8b9",
    label: "Eye Comfort",
    dark: false,
  },
  cream: {
    bg: "#f8f4ec",
    text: "#2b2723",
    muted: "#70685f",
    accent: "#2563eb",
    chromeBg: "rgba(244, 239, 229, 0.95)",
    border: "#e4ddd0",
    label: "Cream",
    dark: false,
  },
  sepia: {
    bg: "#f1e4c9",
    text: "#433220",
    muted: "#7a654b",
    accent: "#8a5a2b",
    chromeBg: "rgba(232, 218, 191, 0.95)",
    border: "#dbc9a6",
    label: "Sepia",
    dark: false,
  },
  dark: {
    bg: "#1c1f24",
    text: "#e6e6e6",
    muted: "#9aa0a6",
    accent: "#8ab4f8",
    chromeBg: "rgba(32, 35, 41, 0.95)",
    border: "#2e333b",
    label: "Night",
    dark: true,
  },
  black: {
    bg: "#000000",
    text: "#d8d8d8",
    muted: "#8a8a8a",
    accent: "#7cc0ff",
    chromeBg: "rgba(12, 12, 14, 0.95)",
    border: "#222226",
    label: "Pure Dark",
    dark: true,
  },
};

export const READER_FONT_STACKS: Record<ReaderFont, string> = {
  publisher:
    'Georgia, "Palatino Linotype", "Book Antiqua", Palatino, "Noto Serif", "Noto Serif Devanagari", "Noto Naskh Arabic", serif',
  serif:
    'Georgia, "Iowan Old Style", "Times New Roman", "Noto Serif", "Noto Serif Devanagari", "Noto Naskh Arabic", "Noto Nastaliq Urdu", "Noto Sans CJK SC", serif',
  literata:
    '"Palatino Linotype", "Book Antiqua", Georgia, "Noto Serif", "Noto Serif Devanagari", "Noto Naskh Arabic", serif',
  sans:
    'Inter, "Helvetica Neue", Helvetica, Arial, "Noto Sans", "Noto Sans Devanagari", "Noto Sans Arabic", "Noto Nastaliq Urdu", "Noto Sans CJK SC", system-ui, sans-serif',
  dyslexic:
    '"Trebuchet MS", Verdana, "Comic Sans MS", "Noto Sans Devanagari", "Noto Sans Arabic", sans-serif',
};

export function isDarkReaderTheme(theme: ReaderTheme): boolean {
  return READER_THEMES[theme]?.dark ?? false;
}

export function normalizeReaderSettings(raw?: Partial<ReaderSettings> | null): ReaderSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_READER_SETTINGS;
  const merged: ReaderSettings = { ...DEFAULT_READER_SETTINGS, ...raw };
  if (!(merged.theme in READER_THEMES)) merged.theme = DEFAULT_READER_SETTINGS.theme;
  if (!(merged.font in READER_FONT_STACKS)) merged.font = DEFAULT_READER_SETTINGS.font;
  merged.fontSize = Math.min(34, Math.max(12, Number(merged.fontSize) || DEFAULT_READER_SETTINGS.fontSize));
  merged.lineHeight = Math.min(2.2, Math.max(1.25, Number(merged.lineHeight) || DEFAULT_READER_SETTINGS.lineHeight));
  merged.margin = Math.min(3, Math.max(0, Math.round(Number(merged.margin ?? DEFAULT_READER_SETTINGS.margin))));
  merged.paragraphSpacing = Math.min(1.8, Math.max(0.2, Number(merged.paragraphSpacing) || DEFAULT_READER_SETTINGS.paragraphSpacing));
  merged.brightness = Math.min(1, Math.max(0.5, Number(merged.brightness ?? 1)));
  merged.warmth = Math.min(0.35, Math.max(0, Number(merged.warmth ?? 0)));
  if (raw.pageAnimation === false && !raw.pageTransition) {
    merged.pageTransition = "none";
  }
  merged.pageAnimation = merged.pageTransition !== "none";
  return merged;
}

function readStored(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULT_READER_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READER_SETTINGS;
    return normalizeReaderSettings(JSON.parse(raw) as Partial<ReaderSettings>);
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  const update = useCallback(<K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "pageTransition") {
        next.pageAnimation = value !== "none";
      } else if (key === "pageAnimation") {
        next.pageTransition = value ? (prev.pageTransition === "none" ? "slide" : prev.pageTransition) : "none";
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT_READER_SETTINGS), []);

  return { settings, update, reset, setSettings };
}

