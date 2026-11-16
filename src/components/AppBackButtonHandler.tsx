import { useEffect, useRef } from "react";
import { useNavigate, useLocation, useNavigationType } from "react-router-dom";
import { Capacitor } from "@capacitor/core";

/**
 * AppBackButtonHandler
 * --------------------
 * Wires the Android hardware back button for Bookshelf & Auth routes:
 * - On deep routes (book detail, reader, edit, channel) -> navigate(-1)
 * - On root (/ or /bookshelf or /auth) -> exit app
 */
export const AppBackButtonHandler = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const navType = useNavigationType();

  const pathRef = useRef(location.pathname);
  const depth = useRef(0);

  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (navType === "PUSH") depth.current += 1;
    else if (navType === "POP") depth.current = Math.max(0, depth.current - 1);
  }, [location.key, navType]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    let remove: (() => void) | undefined;

    import("@capacitor/app")
      .then(({ App }) => {
        if (cancelled) return;
        App.addListener("backButton", () => {
          const path = pathRef.current;
          const isRoot = path === "/" || path === "/bookshelf" || path === "/auth";

          if (!isRoot && depth.current > 0) {
            navigate(-1);
          } else {
            App.exitApp();
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
