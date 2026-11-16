export interface PagedGeometryInput {
  viewportWidth: number;
  viewportHeight: number;
  baseGap: number;
  verticalPadding: number;
  fontSize: number;
  lineHeight: number;
  maxContentWidth: number;
  imageMode: boolean;
  pageSpread?: "auto" | "single";
}

export interface PagedGeometry {
  viewportWidth: number;
  viewportHeight: number;
  columns: 1 | 2;
  spreadWidth: number;
  columnWidth: number;
  columnGap: number;
  sideOffset: number;
  topOffset: number;
  height: number;
  step: number;
}

/**
 * Computes Google Play Books–style centered page geometry inside any viewport
 * (mobile, tablet, desktop) while keeping step === viewportWidth so CSS
 * multi-column paging translates cleanly with zero bleed between pages.
 *
 * When `pageSpread === "auto"` on wide tablet/desktop viewports (>= 1024px)
 * and `!imageMode`, renders a balanced 2-page book spread with symmetrical
 * outer margins (`colGap / 2`) and center spine (`colGap`), preserving
 * `2 * (columnWidth + columnGap) === viewportWidth`.
 */
export function computePagedGeometry({
  viewportWidth,
  viewportHeight,
  baseGap,
  verticalPadding,
  fontSize,
  lineHeight,
  maxContentWidth,
  imageMode,
  pageSpread = "single",
}: PagedGeometryInput): PagedGeometry {
  const safeViewportW = Math.max(Math.round(viewportWidth), 1);
  const safeViewportH = Math.max(Math.round(viewportHeight), 1);

  // Never let wide margin settings crush narrow mobile screens
  const maxSafeBaseGap = Math.max(16, Math.floor(safeViewportW * 0.35));
  const effectiveBaseGap = Math.min(Math.max(baseGap, 0), maxSafeBaseGap);

  const useTwoPageSpread =
    pageSpread === "auto" && !imageMode && safeViewportW >= 1024;
  const columns: 1 | 2 = useTwoPageSpread ? 2 : 1;

  let columnWidth: number;
  let columnGap: number;
  let sideOffset: number;
  let spreadWidth: number;

  if (useTwoPageSpread) {
    // 2 columns + 2 * colGap = safeViewportW (left/right margin = colGap/2, center spine = colGap)
    const minGutter = Math.max(32, effectiveBaseGap);
    const maxColByViewport = Math.floor((safeViewportW - minGutter * 2) / 2);
    const preferredMax = Math.min(Math.max(maxContentWidth * 0.88, 380), 580);
    columnWidth = Math.max(260, Math.min(maxColByViewport, preferredMax));
    columnGap = Math.max(24, (safeViewportW - columnWidth * 2) / 2);
    sideOffset = columnGap / 2;
    spreadWidth = columnWidth * 2 + columnGap;
  } else {
    const availableWidth = Math.max(safeViewportW - effectiveBaseGap, 1);
    columnWidth = imageMode
      ? availableWidth
      : Math.max(1, Math.min(availableWidth, Math.max(maxContentWidth, 240)));

    // Center the readable column in the viewport; step === columnWidth + columnGap === safeViewportW
    columnGap = Math.max(0, safeViewportW - columnWidth);
    sideOffset = columnGap / 2;
    spreadWidth = columnWidth;
  }

  const step = safeViewportW;

  const safeVerticalPadding = Math.min(Math.max(verticalPadding, 8), Math.floor(safeViewportH * 0.2));
  const availableHeight = Math.max(safeViewportH - safeVerticalPadding * 2, 1);
  const lineBox = Math.max(fontSize * lineHeight, 1);
  const height = imageMode
    ? availableHeight
    : Math.max(Math.floor(availableHeight / lineBox) * lineBox, Math.min(lineBox, availableHeight));
  const topOffset = Math.max(safeVerticalPadding, (safeViewportH - height) / 2);

  return {
    viewportWidth: safeViewportW,
    viewportHeight: safeViewportH,
    columns,
    spreadWidth,
    columnWidth,
    columnGap,
    sideOffset,
    topOffset,
    height,
    step,
  };
}

/**
 * Computes total page count from measured horizontal content extent and step.
 * Uses a 4px subpixel tolerance so page k never spawns a blank trailing page,
 * while any real text/element in column k+1 always advances totalPages.
 */
export function computeTotalPages(extent: number, step: number): number {
  const safeStep = Math.max(step, 1);
  const safeExtent = Math.max(extent, 0);
  return Math.max(1, Math.ceil((safeExtent - 4) / safeStep));
}

