import { describe, it, expect } from "vitest";
import { computePagedGeometry, computeTotalPages } from "./paginationMath";
import {
  DEFAULT_READER_SETTINGS,
  isDarkReaderTheme,
  normalizeReaderSettings,
} from "./settings";

describe("paginationMath (Play Books adaptive page flow)", () => {
  it("centers readable columns on desktop without full-width line stretching", () => {
    const geom = computePagedGeometry({
      viewportWidth: 1440,
      viewportHeight: 900,
      baseGap: 52,
      verticalPadding: 20,
      fontSize: 19,
      lineHeight: 1.65,
      maxContentWidth: 700,
      imageMode: false,
    });

    expect(geom.columns).toBe(1);
    expect(geom.columnWidth).toBe(700);
    expect(geom.columnGap).toBe(740);
    expect(geom.sideOffset).toBe(370);
    expect(geom.step).toBe(1440);
    expect(geom.columnWidth + geom.columnGap).toBe(geom.step);
    // Height must snap to an exact integer multiple of lineBox (31.35px)
    const lineBox = 19 * 1.65;
    const ratio = geom.height / lineBox;
    expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(1e-9);
  });

  it("renders balanced 2-page spread on wide desktop when pageSpread='auto'", () => {
    const geom = computePagedGeometry({
      viewportWidth: 1440,
      viewportHeight: 900,
      baseGap: 52,
      verticalPadding: 20,
      fontSize: 19,
      lineHeight: 1.65,
      maxContentWidth: 640,
      imageMode: false,
      pageSpread: "auto",
    });

    expect(geom.columns).toBe(2);
    expect(2 * (geom.columnWidth + geom.columnGap)).toBe(1440);
    expect(geom.spreadWidth).toBe(geom.columnWidth * 2 + geom.columnGap);
    expect(geom.step).toBe(1440);
  });

  it("falls back to 1 column on tablet portrait even when pageSpread='auto'", () => {
    const geom = computePagedGeometry({
      viewportWidth: 768,
      viewportHeight: 1024,
      baseGap: 52,
      verticalPadding: 20,
      fontSize: 19,
      lineHeight: 1.65,
      maxContentWidth: 700,
      imageMode: false,
      pageSpread: "auto",
    });

    expect(geom.columns).toBe(1);
    expect(geom.columnWidth).toBe(700);
    expect(geom.sideOffset).toBe(34);
    expect(geom.step).toBe(768);
  });

  it("protects mobile screens from oversized margins", () => {
    const geom = computePagedGeometry({
      viewportWidth: 375,
      viewportHeight: 812,
      baseGap: 120,
      verticalPadding: 20,
      fontSize: 19,
      lineHeight: 1.65,
      maxContentWidth: 580,
      imageMode: false,
    });

    expect(geom.columnWidth).toBeGreaterThanOrEqual(240);
    expect(geom.columnWidth + geom.columnGap).toBe(375);
  });

  it("uses full available width for scanned image books", () => {
    const geom = computePagedGeometry({
      viewportWidth: 1440,
      viewportHeight: 900,
      baseGap: 52,
      verticalPadding: 20,
      fontSize: 19,
      lineHeight: 1.65,
      maxContentWidth: 700,
      imageMode: true,
    });

    expect(geom.columns).toBe(1);
    expect(geom.columnWidth).toBe(1440 - 52);
    expect(geom.height).toBe(900 - 40);
  });

  it("computes exact page counts without losing partial last columns or adding blank pages", () => {
    // Desktop: step=1440, columnWidth=700, columnGap=740
    expect(computeTotalPages(700, 1440)).toBe(1);
    expect(computeTotalPages(703, 1440)).toBe(1);
    expect(computeTotalPages(1440, 1440)).toBe(1);
    // Partial spill into page 2 (starts at x=1440 + sideOffset)
    expect(computeTotalPages(1850, 1440)).toBe(2);
    expect(computeTotalPages(2140, 1440)).toBe(2);
    // Mobile: step=390
    expect(computeTotalPages(358, 390)).toBe(1);
    expect(computeTotalPages(396, 390)).toBe(2);
    expect(computeTotalPages(780, 390)).toBe(2);
  });

  it("normalizes persisted reader settings and detects dark themes cleanly", () => {
    expect(normalizeReaderSettings(null)).toEqual(DEFAULT_READER_SETTINGS);
    const normalized = normalizeReaderSettings({
      fontSize: 99,
      lineHeight: 0.5,
      brightness: 0.1,
      warmth: 0.9,
      pageAnimation: false,
      theme: "dark",
    });
    expect(normalized.fontSize).toBe(34);
    expect(normalized.lineHeight).toBe(1.25);
    expect(normalized.brightness).toBe(0.5);
    expect(normalized.warmth).toBe(0.35);
    expect(normalized.pageTransition).toBe("none");
    expect(normalized.pageAnimation).toBe(false);
    expect(isDarkReaderTheme("dark")).toBe(true);
    expect(isDarkReaderTheme("black")).toBe(true);
    expect(isDarkReaderTheme("warm")).toBe(false);
  });
});
