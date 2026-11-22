import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { MobileProvider } from "./contexts/MobileContext";
import { Suspense, lazy as reactLazy, useEffect, ComponentType } from "react";
import { Loader2 } from "lucide-react";
import { ThemeProvider } from "next-themes";
import { RouteErrorBoundary } from "./components/ErrorBoundary";
import { AppBackButtonHandler } from "./components/AppBackButtonHandler";
import { AdProvider } from "./contexts/AdContext";
import { AudiobookProvider } from "./contexts/AudiobookContext";
import MiniAudioPlayer from "./components/bookshelf/reader/MiniAudioPlayer";
import { useIsMobile } from "./hooks/use-mobile";
import { shouldRetryQuery } from "./integrations/supabase/config";

// Wrap React.lazy to auto-recover from stale chunk errors after a new deploy.
const lazy = <T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) =>
  reactLazy(() =>
    factory().catch((err) => {
      const msg = String(err?.message || err);
      const isChunkError =
        /Failed to fetch dynamically imported module/i.test(msg) ||
        /Importing a module script failed/i.test(msg) ||
        /ChunkLoadError/i.test(msg);
      if (isChunkError && typeof window !== "undefined") {
        const key = "__lv_chunk_reload__";
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, "1");
          window.location.reload();
          return new Promise<{ default: T }>(() => {});
        }
      }
      throw err;
    }),
  );

const bookshelfImport = () => import("./pages/Bookshelf");

const Bookshelf = lazy(bookshelfImport);
const BookDetail = lazy(() => import("./pages/BookDetail"));
const EditBook = lazy(() => import("./pages/EditBook"));
const BookReader = lazy(() => import("./pages/BookReader"));
const AuthorChannel = lazy(() => import("./pages/AuthorChannel"));
const EditAuthorChannel = lazy(() => import("./pages/EditAuthorChannel"));
const ChannelAnalytics = lazy(() => import("./pages/ChannelAnalytics"));
const BookAnalytics = lazy(() => import("./pages/BookAnalytics"));
const Auth = lazy(() => import("./pages/Auth"));
const LibraryDashboard = lazy(() => import("./pages/LibraryDashboard"));
const Settings = lazy(() => import("./pages/Settings"));
const AdminPanel = lazy(() => import("./pages/AdminPanel"));
const OfflinePage = lazy(() => import("./pages/Offline"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: shouldRetryQuery,
      refetchOnWindowFocus: false,
    },
  },
});

const RouteLoader = () => (
  <div className="min-h-[50vh] flex items-center justify-center bg-background">
    <Loader2 className="w-6 h-6 animate-spin text-primary" />
  </div>
);

const withSuspense = (Component: React.ComponentType) => (
  <RouteErrorBoundary>
    <Suspense fallback={<RouteLoader />}>
      <Component />
    </Suspense>
  </RouteErrorBoundary>
);

const ModulePrefetcher = () => {
  useEffect(() => {
    const ric: any = (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 1500));
    const handle = ric(
      () => {
        bookshelfImport().catch(() => {});
      },
      { timeout: 4000 },
    );
    return () => {
      const cic: any = (window as any).cancelIdleCallback;
      if (cic && typeof handle === "number") cic(handle);
    };
  }, []);
  return null;
};

const ResponsiveSonner = () => {
  const isMobile = useIsMobile();
  return (
    <Sonner
      position={isMobile ? "bottom-center" : "top-center"}
      offset={isMobile ? "calc(12px + env(safe-area-inset-bottom))" : undefined}
    />
  );
};

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={true} disableTransitionOnChange>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <ResponsiveSonner />
        <BrowserRouter>
          <AuthProvider>
            <MobileProvider>
              <AdProvider>
                <AudiobookProvider>
                  <ModulePrefetcher />
                  <AppBackButtonHandler />
                  <div className="min-h-screen bg-background safe-left safe-right">
                    <Routes>
                      <Route path="/auth" element={withSuspense(Auth)} />
                      <Route path="/offline" element={withSuspense(OfflinePage)} />
                      <Route
                        path="/"
                        element={<ProtectedRoute>{withSuspense(Bookshelf)}</ProtectedRoute>}
                      />
                      <Route
                        path="/bookshelf"
                        element={<ProtectedRoute>{withSuspense(Bookshelf)}</ProtectedRoute>}
                      />
                      <Route
                        path="/bookshelf/edit/:bookId"
                        element={<ProtectedRoute>{withSuspense(EditBook)}</ProtectedRoute>}
                      />
                      <Route
                        path="/bookshelf/read/:bookId"
                        element={<ProtectedRoute>{withSuspense(BookReader)}</ProtectedRoute>}
                      />
                      <Route
                        path="/bookshelf/book/:bookId/analytics"
                        element={<ProtectedRoute>{withSuspense(BookAnalytics)}</ProtectedRoute>}
                      />
                      <Route
                        path="/bookshelf/book/:bookId"
                        element={<ProtectedRoute>{withSuspense(BookDetail)}</ProtectedRoute>}
                      />
                      <Route
                        path="/bookshelf/channel/:channelId/analytics"
                        element={<ProtectedRoute>{withSuspense(ChannelAnalytics)}</ProtectedRoute>}
                      />
                      <Route
                        path="/bookshelf/channel/:channelId"
                        element={<ProtectedRoute>{withSuspense(AuthorChannel)}</ProtectedRoute>}
                      />
                      <Route
                        path="/bookshelf/channel/:channelId/edit"
                        element={<ProtectedRoute>{withSuspense(EditAuthorChannel)}</ProtectedRoute>}
                      />
                      <Route
                        path="/dashboard"
                        element={<ProtectedRoute>{withSuspense(LibraryDashboard)}</ProtectedRoute>}
                      />
                      <Route
                        path="/settings"
                        element={<ProtectedRoute>{withSuspense(Settings)}</ProtectedRoute>}
                      />
                      <Route
                        path="/admin"
                        element={<ProtectedRoute>{withSuspense(AdminPanel)}</ProtectedRoute>}
                      />
                      <Route path="*" element={withSuspense(NotFound)} />
                    </Routes>
                    <MiniAudioPlayer />
                  </div>
                </AudiobookProvider>
              </AdProvider>
            </MobileProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
