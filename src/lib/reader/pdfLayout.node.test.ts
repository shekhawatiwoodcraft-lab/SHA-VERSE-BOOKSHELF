import test from "node:test";
import assert from "node:assert/strict";
import { computePdfCanvasMetrics, getDefaultPdfFitMode } from "./pdfLayout";

test("getDefaultPdfFitMode picks width on phones and page on tablet/desktop", () => {
  assert.equal(getDefaultPdfFitMode(390), "width");
  assert.equal(getDefaultPdfFitMode(767), "width");
  assert.equal(getDefaultPdfFitMode(768), "page");
  assert.equal(getDefaultPdfFitMode(1440), "page");
});

test("computePdfCanvasMetrics keeps width fitted inside mobile viewport in width mode at 1x", () => {
  const metrics = computePdfCanvasMetrics({
    containerWidth: 390,
    containerHeight: 580,
    pageWidth: 600,
    pageHeight: 900,
    fitMode: "width",
    scale: 1,
  });

  assert.equal(metrics.availableWidth, 378);
  assert.equal(metrics.renderedWidth, 378);
  assert.equal(metrics.overflowsHorizontally, false);
  assert.equal(metrics.renderedHeight, 567);

  // Taller page overflows vertically so user can scroll up/down while left/right stays inside screen
  const tallMetrics = computePdfCanvasMetrics({
    containerWidth: 390,
    containerHeight: 460,
    pageWidth: 600,
    pageHeight: 1000,
    fitMode: "width",
    scale: 1,
  });
  assert.equal(tallMetrics.overflowsHorizontally, false);
  assert.equal(tallMetrics.overflowsVertically, true);
});

test("computePdfCanvasMetrics allows scaled zoom > 1x while reporting both overflow axes", () => {
  const zoomed = computePdfCanvasMetrics({
    containerWidth: 390,
    containerHeight: 580,
    pageWidth: 600,
    pageHeight: 900,
    fitMode: "width",
    scale: 1.5,
  });

  assert.equal(zoomed.renderedWidth, 567);
  assert.equal(zoomed.overflowsHorizontally, true);
  assert.equal(zoomed.overflowsVertically, true);
});
