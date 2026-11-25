export interface PdfCanvasMetricsInput {
  containerWidth: number;
  containerHeight: number;
  pageWidth: number;
  pageHeight: number;
  fitMode: "page" | "width";
  scale: number;
}

export interface PdfCanvasMetrics {
  availableWidth: number;
  availableHeight: number;
  fitScale: number;
  responsiveScale: number;
  renderedWidth: number;
  renderedHeight: number;
  overflowsHorizontally: boolean;
  overflowsVertically: boolean;
}

export function getDefaultPdfFitMode(viewportWidth: number): "page" | "width" {
  return viewportWidth > 0 && viewportWidth < 768 ? "width" : "page";
}

export function computePdfCanvasMetrics({
  containerWidth,
  containerHeight,
  pageWidth,
  pageHeight,
  fitMode,
  scale,
}: PdfCanvasMetricsInput): PdfCanvasMetrics {
  const safeContainerWidth = Math.max(containerWidth, 240);
  const safeContainerHeight = Math.max(containerHeight, 240);
  // Keep compact horizontal padding on phones so PDF pages fill width cleanly
  // without clipping left/right edges.
  const horizontalPad = safeContainerWidth < 640 ? 12 : 24;
  const verticalPad = safeContainerWidth < 640 ? 12 : 24;

  const availableWidth = Math.max(safeContainerWidth - horizontalPad, 220);
  const availableHeight = Math.max(safeContainerHeight - verticalPad, 200);

  const safePageWidth = Math.max(pageWidth, 1);
  const safePageHeight = Math.max(pageHeight, 1);
  const scaleByWidth = availableWidth / safePageWidth;
  const scaleByHeight = availableHeight / safePageHeight;

  const fitScale =
    fitMode === "width" ? scaleByWidth : Math.min(scaleByWidth, scaleByHeight);
  const responsiveScale = Math.max(0.1, fitScale) * Math.max(0.25, scale);

  const renderedWidth = Math.round(safePageWidth * responsiveScale);
  const renderedHeight = Math.round(safePageHeight * responsiveScale);

  return {
    availableWidth,
    availableHeight,
    fitScale,
    responsiveScale,
    renderedWidth,
    renderedHeight,
    overflowsHorizontally: renderedWidth > safeContainerWidth,
    overflowsVertically: renderedHeight > safeContainerHeight,
  };
}
