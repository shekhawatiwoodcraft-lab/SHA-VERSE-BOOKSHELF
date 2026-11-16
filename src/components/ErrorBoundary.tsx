import { Component, ErrorInfo, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Human-readable name of the area this boundary protects (module or page). */
  contextLabel?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * ErrorBoundary
 * -------------
 * Contains render-time crashes so one module/page can never blank the whole app.
 *
 * - Per-module boundaries (inside KeepAliveModules): the error stays until the
 *   user taps "Try again", so module state is preserved on recovery.
 * - Route boundaries (RouteErrorBoundary): keyed by pathname, so navigating
 *   away automatically resets the boundary.
 * - Root boundary (main.tsx): last-resort safety net around the whole app.
 *
 * Presentation-only. It does not touch queries, Supabase, auth, ads, push,
 * realtime, or any business logic — it only catches render errors.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Diagnosis only — no user-facing behavior change.
    console.error(
      `[ErrorBoundary:${this.props.contextLabel ?? "app"}]`,
      error,
      info.componentStack,
    );
  }

  private handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-[50vh] flex items-center justify-center p-4 bg-background">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {this.props.contextLabel
              ? `${this.props.contextLabel} couldn't be displayed. The rest of the app is still working.`
              : "This screen couldn't be displayed. The rest of the app is still working."}
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <Button onClick={this.handleReset} className="min-h-11">
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()} className="min-h-11">
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Reload app
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * RouteErrorBoundary
 * ------------------
 * Wraps a routed page. Keyed by pathname so navigating away from a broken
 * deep page (reader, watch, post detail, ...) automatically resets the
 * boundary — the user gets a clean page on the next visit.
 * Must be rendered inside the router (it reads the current location).
 */
export const RouteErrorBoundary = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary key={pathname} contextLabel="This page">
      {children}
    </ErrorBoundary>
  );
};
