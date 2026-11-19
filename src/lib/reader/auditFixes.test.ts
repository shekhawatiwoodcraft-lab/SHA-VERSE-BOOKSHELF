import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLines,
  dedupeRawItems,
  filterRunningEdges,
  linesToBlocks,
  orderColumns,
  type Line,
} from "./layoutEngine";
import { assessPageText, isGarbageLine } from "./quality";
import { hasMathEquationSyntax, isHiddenMetadata, repairSmallCaps } from "./sanitize";
import { chunkBlocksByBudget, validateTranslationBatch } from "../ai/segments";
import { InAppNavigationController, resolveRouteFallback } from "../navigation";

test("dedupeRawItems and buildLines remove faux-bold duplicate glyphs like Reading without altering real text", () => {
  const deduped = dedupeRawItems([
    { str: "Reading", x: 100, y: 700, width: 42, size: 12, bold: false, italic: false },
    { str: "Reading", x: 100.4, y: 700, width: 42, size: 12, bold: false, italic: false },
    { str: "Skills", x: 148, y: 700, width: 32, size: 12, bold: false, italic: false },
  ]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].bold, true);

  const lines = buildLines([
    { str: "Reading", transform: [12, 0, 0, 12, 100, 700], width: 42, fontName: "F1" },
    { str: "Reading", transform: [12, 0, 0, 12, 100.3, 700], width: 42, fontName: "F1" },
    { str: "Comprehension", transform: [12, 0, 0, 12, 147, 700], width: 84, fontName: "F1" },
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "Reading Comprehension");
});

test("buildLines preserves Devanagari matras and virama conjuncts without stray spaces and orders RTL Urdu text with embedded LTR phrases", () => {
  const hindiLines = buildLines([
    { str: "हिन्", transform: [14, 0, 0, 14, 100, 680], width: 16, fontName: "F2" },
    { str: "द", transform: [14, 0, 0, 14, 119, 680], width: 8, fontName: "F2" },
    { str: "ी", transform: [14, 0, 0, 14, 131, 680], width: 5, fontName: "F2" },
    { str: "किताब", transform: [14, 0, 0, 14, 145, 680], width: 36, fontName: "F2" },
  ]);
  assert.equal(hindiLines.length, 1);
  assert.equal(hindiLines[0].text, "हिन्दी किताब");

  const urduLines = buildLines([
    { str: "میں", transform: [14, 0, 0, 14, 420, 650], width: 22, fontName: "F3" },
    { str: "کتاب", transform: [14, 0, 0, 14, 385, 650], width: 28, fontName: "F3" },
    { str: "New", transform: [14, 0, 0, 14, 290, 650], width: 24, fontName: "F3" },
    { str: "York", transform: [14, 0, 0, 14, 320, 650], width: 24, fontName: "F3" },
    { str: "ہوں", transform: [14, 0, 0, 14, 240, 650], width: 24, fontName: "F3" },
  ]);
  assert.equal(urduLines.length, 1);
  assert.equal(urduLines[0].text, "میں کتاب New York ہوں");
});

test("orderColumns separates two-column bands in LTR and RTL order while preserving full-width titles", () => {
  const mkLine = (text: string, x: number, right: number, y: number): Line => ({
    text,
    x,
    right,
    y,
    size: 11,
    bold: false,
    italic: false,
    itemXs: [x],
  });

  const ltrPage: Line[] = [
    mkLine("Full Width Chapter Heading", 80, 520, 740),
    mkLine("Left column line 1", 60, 260, 700),
    mkLine("Right column line 1", 320, 530, 700),
    mkLine("Left column line 2", 60, 260, 684),
    mkLine("Right column line 2", 320, 530, 684),
    mkLine("Left column line 3", 60, 260, 668),
    mkLine("Right column line 3", 320, 530, 668),
  ];
  const orderedLtr = orderColumns(ltrPage, 600);
  assert.deepEqual(
    orderedLtr.map((l) => l.text),
    [
      "Full Width Chapter Heading",
      "Left column line 1",
      "Left column line 2",
      "Left column line 3",
      "Right column line 1",
      "Right column line 2",
      "Right column line 3",
    ],
  );

  const rtlPage: Line[] = [
    mkLine("پہلا بایاں کالم", 60, 260, 700),
    mkLine("پہلا دایاں کالم", 320, 530, 700),
    mkLine("دوسرا بایاں کالم", 60, 260, 684),
    mkLine("دوسرا دایاں کالم", 320, 530, 684),
    mkLine("تیسرا بایاں کالم", 60, 260, 668),
    mkLine("تیسرا دایاں کالم", 320, 530, 668),
  ];
  const orderedRtl = orderColumns(rtlPage, 600);
  assert.equal(orderedRtl[0].text, "پہلا دایاں کالم");
  assert.equal(orderedRtl[3].text, "پہلا بایاں کالم");
});

test("filterRunningEdges keeps genuine chapter titles and strips repeated edge headers and folios", () => {
  const counts = new Map<string, number>();
  const mk = (text: string, y: number, size = 11): Line => ({
    text,
    x: 60,
    right: 300,
    y,
    size,
    bold: false,
    italic: false,
    itemXs: [60],
  });

  // First page sees numbered running header once, genuine large heading near top, and body + bottom page number
  const p1 = filterRunningEdges(
    [
      mk("6 Preface", 740, 10),
      mk("CHAPTER I THE OLD MINE", 725, 18),
      mk("Body text in the middle.", 450, 11),
      mk("1", 40, 10),
    ],
    800,
    11,
    counts,
  );
  assert.ok(p1.some((l) => l.text === "CHAPTER I THE OLD MINE"));
  assert.ok(!p1.some((l) => l.text === "1"));

  // Second page repeats numbered running header -> stripped while content stays intact
  const p2 = filterRunningEdges(
    [mk("8 Preface", 740, 10), mk("Next body line.", 500, 11)],
    800,
    11,
    counts,
  );
  assert.ok(!p2.some((l) => l.text === "8 Preface"));
  assert.ok(p2.some((l) => l.text === "Next body line."));
});

test("quality and sanitize preserve ALL-CAPS titles and math equations while catching CMap Hindi corruption and OCR noise", () => {
  assert.equal(isGarbageLine("TWO BOY GOLD MINERS"), false);
  assert.equal(hasMathEquationSyntax("E = m c^2"), true);
  assert.equal(hasMathEquationSyntax("∑_{i=1}^n x_i = n(n+1)/2"), true);
  assert.equal(isHiddenMetadata("f(x) = x^2 + 3x - 5"), false);
  assert.equal(isGarbageLine("dx/dt = 2x + y"), false);
  assert.equal(repairSmallCaps("U S ARMY"), "U S ARMY");
  assert.equal(repairSmallCaps("BY J ERROLD E. HOGLE"), "BY JERROLD E. HOGLE");
  assert.equal(repairSmallCaps("C HAPTER ONE"), "CHAPTER ONE");

  // Broken iText Devanagari CMap symbols (Balinese/Ol Chiki mixed with Devanagari) must fail quality check cleanly
  const brokenHindi = assessPageText([
    "कᳱ नहᱭ जा᭮ नवी दोनᲂ पᱟँच साᭃी थे।",
    "वह अपने घर कᳱ ओर चल दियᳲ और नहᱭ लौटे।",
  ]);
  assert.equal(brokenHindi.unusable, true);
  assert.equal(brokenHindi.reason, "glyph-damage");

  // Short OCR noise artifact page must be flagged unusable
  const shortNoise = assessPageText([": beaon otHem Gh thre,"]);
  assert.equal(shortNoise.unusable, true);

  // Equations stay paragraph blocks, not headings
  let seq = 0;
  const { blocks } = linesToBlocks(
    [
      { text: "Newton's Law", x: 60, right: 200, y: 700, size: 16, bold: true, italic: false, itemXs: [60] },
      { text: "F = m * a", x: 120, right: 200, y: 670, size: 12, bold: false, italic: false, itemXs: [120] },
    ],
    1,
    { bodySize: 12, bodySamples: [12, 12, 12] },
    () => `id_${seq++}`,
  );
  assert.equal(blocks[0].type, "heading");
  assert.equal(blocks[1].type, "paragraph");
});

test("chunkBlocksByBudget respects block and char limits and validateTranslationBatch checks completeness", () => {
  const longBlocks = Array.from({ length: 12 }, (_, idx) => ({
    id: `b${idx}`,
    text: "x".repeat(3000),
  }));
  const batches = chunkBlocksByBudget(longBlocks, 10, 10_000);
  assert.equal(batches.length, 4);
  for (const b of batches) {
    assert.ok(b.length <= 10);
    const total = b.reduce((sum, item) => sum + item.text.length, 0);
    assert.ok(total <= 10_000);
  }

  const ok = validateTranslationBatch(
    [{ id: "b1", text: "Hello" }],
    [{ id: " b1 ", translatedText: "नमस्ते" }],
  );
  assert.equal(ok.valid, true);
  assert.equal(ok.map.b1, "नमस्ते");
});

test("InAppNavigationController prioritizes overlays, tracks history cleanly, and resolves deep-link fallbacks", () => {
  const nav = new InAppNavigationController();
  assert.equal(nav.canGoBack(), false);

  nav.recordNavigation("k1", "/bookshelf", "PUSH");
  nav.recordNavigation("k2", "/bookshelf/book/b1", "PUSH");
  nav.recordNavigation("k3", "/bookshelf/read/b1", "PUSH");
  assert.equal(nav.canGoBack(), true);
  assert.equal(nav.getPreviousPath(), "/bookshelf/book/b1");

  let closedSettings = false;
  let closedSearch = false;
  nav.pushOverlay("search", () => { closedSearch = true; });
  nav.pushOverlay("settings", () => { closedSettings = true; });

  assert.equal(nav.popOverlay(), true);
  assert.equal(closedSettings, true);
  assert.equal(closedSearch, false);

  assert.equal(nav.popOverlay(), true);
  assert.equal(closedSearch, true);
  assert.equal(nav.popOverlay(), false);

  nav.recordNavigation("k2", "/bookshelf/book/b1", "POP");
  assert.equal(nav.getDepth(), 1);

  assert.equal(resolveRouteFallback("/bookshelf/read/abc"), "/bookshelf/book/abc");
  assert.equal(resolveRouteFallback("/bookshelf/book/abc/analytics"), "/bookshelf/book/abc");
  assert.equal(resolveRouteFallback("/bookshelf/channel/ch1/analytics"), "/bookshelf/channel/ch1");
  assert.equal(resolveRouteFallback("/bookshelf/edit/abc"), "/bookshelf/book/abc");
});
