import { useCallback, useEffect } from "react";
import { useNavigate, type NavigationType } from "react-router-dom";

export interface HistoryEntry {
  key: string;
  path: string;
}

export interface OverlayHandler {
  id: string;
  onBack: () => void;
}

/**
 * Pure, framework-agnostic navigation tracker so Back behavior can be tested
 * deterministically without relying on browser `window.history.length` quirks.
 */
export class InAppNavigationController {
  private stack: HistoryEntry[] = [];
  private overlays: OverlayHandler[] = [];

  recordNavigation(key: string, path: string, navType: NavigationType | "PUSH" | "POP" | "REPLACE") {
    const safeKey = key || path;
    if (this.stack.length === 0) {
      this.stack.push({ key: safeKey, path });
      return;
    }

    if (navType === "REPLACE") {
      this.stack[this.stack.length - 1] = { key: safeKey, path };
      return;
    }

    if (navType === "POP") {
      const idx = this.stack.findIndex((entry) => entry.key === safeKey);
      if (idx >= 0) {
        this.stack = this.stack.slice(0, idx + 1);
      } else if (this.stack.length > 1) {
        this.stack.pop();
      } else {
        this.stack = [{ key: safeKey, path }];
      }
      return;
    }

    // PUSH: avoid duplicate adjacent entry for identical key
    const top = this.stack[this.stack.length - 1];
    if (top.key === safeKey) {
      this.stack[this.stack.length - 1] = { key: safeKey, path };
      return;
    }
    this.stack.push({ key: safeKey, path });
  }

  canGoBack(): boolean {
    return this.stack.length > 1;
  }

  getDepth(): number {
    return Math.max(0, this.stack.length - 1);
  }

  getPreviousPath(): string | null {
    return this.stack.length > 1 ? this.stack[this.stack.length - 2].path : null;
  }

  pushOverlay(id: string, onBack: () => void): () => void {
    this.overlays = this.overlays.filter((item) => item.id !== id);
    this.overlays.push({ id, onBack });
    return () => {
      this.overlays = this.overlays.filter((item) => item.id !== id);
    };
  }

  hasOpenOverlay(): boolean {
    return this.overlays.length > 0;
  }

  popOverlay(): boolean {
    const top = this.overlays.pop();
    if (!top) return false;
    top.onBack();
    return true;
  }

  reset() {
    this.stack = [];
    this.overlays = [];
  }
}

export const appNavController = new InAppNavigationController();

/**
 * Registers an open modal / drawer / full-screen settings panel in the global
 * back-button stack so hardware Back or header Back closes overlays before routing.
 */
export function useRegisterBackOverlay(open: boolean, id: string, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    return appNavController.pushOverlay(id, onClose);
  }, [open, id, onClose]);
}

/**
 * Returns a consistent Back action that:
 * 1) Closes any registered top-level overlay if open (optional skipOverlays for overlay-internal controls)
 * 2) Goes back in real in-app history if user navigated from within the app
 * 3) Falls back cleanly to a contextual parent route on direct-entry/deep links.
 */
export function useSmartBack(fallbackPath = "/bookshelf") {
  const navigate = useNavigate();

  return useCallback(
    (opts?: { skipOverlays?: boolean }) => {
      if (!opts?.skipOverlays && appNavController.popOverlay()) {
        return;
      }
      if (appNavController.canGoBack()) {
        navigate(-1);
        return;
      }
      navigate(fallbackPath, { replace: true });
    },
    [navigate, fallbackPath],
  );
}

/** Resolves a sensible parent fallback path for any route when in-app history is empty. */
export function resolveRouteFallback(pathname: string): string {
  if (/^\/bookshelf\/book\/[^/]+\/analytics/.test(pathname)) {
    return pathname.replace(/\/analytics\/?$/, "");
  }
  if (/^\/bookshelf\/channel\/[^/]+\/(analytics|edit)/.test(pathname)) {
    return pathname.replace(/\/(analytics|edit)\/?$/, "");
  }
  if (/^\/bookshelf\/edit\/([^/]+)/.test(pathname)) {
    const m = /^\/bookshelf\/edit\/([^/]+)/.exec(pathname);
    return m ? `/bookshelf/book/${m[1]}` : "/bookshelf";
  }
  if (/^\/bookshelf\/read\/([^/]+)/.test(pathname)) {
    const m = /^\/bookshelf\/read\/([^/]+)/.exec(pathname);
    return m ? `/bookshelf/book/${m[1]}` : "/bookshelf";
  }
  return "/bookshelf";
}
