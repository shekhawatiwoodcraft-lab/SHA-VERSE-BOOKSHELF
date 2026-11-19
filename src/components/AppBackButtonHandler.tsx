import { useEffect, useRef } from "react";
import { useNavigate, useLocation, useNavigationType } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { appNavController, resolveRouteFallback } from "@/lib/navigation";

/**
 * AppBackButtonHandler
 * --------------------
 * Tracks true in-app route history and wires Android hardware back so:
 * 1) Active overlays (Settings, TOC, Search, Sheets) close first
 * 2) Deep routes pop real in-app history or fall back to contextual parent route
 * 3) Root routes (/ or /bookshelf or /auth) exit natively on Android
 */
export const AppBackButtonHandler = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const navType = useNavigationType();

  const pathRef = useRef(location.pathname);

  useEffect(() => {
    pathRef.current = location.pathname;
    appNavController.recordNavigation(
      location.key,
      `${location.pathname}${location.search}`,
      navType,
    );
  }, [location.key, location.pathname, location.search, navType]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    let remove: (() => void) | undefined;

    import("@capacitor/app")
      .then(({ App }) => {
        if (cancelled) return;
        App.addListener("backButton", () => {
          if (appNavController.popOverlay()) {
            return;
          }

          const path = pathRef.current;
          const isRoot = path === "/" || path === "/bookshelf" || path === "/auth";

          if (isRoot) {
            App.exitApp();
            return;
          }

          if (appNavController.canGoBack()) {
            navigate(-1);
          } else {
            navigate(resolveRouteFallback(path), { replace: true });
          }
        }).then((handle) => {
          if (cancelled) {
            handle.remove();
            return;
          }
          remove = () => handle.remove();
        });
      })
      .catch(() => {
        /* @capacitor/app unavailable — ignore */
      });

    return () => {
      cancelled = true;
      remove?.();
    };
  }, [navigate]);

  return null;
};
