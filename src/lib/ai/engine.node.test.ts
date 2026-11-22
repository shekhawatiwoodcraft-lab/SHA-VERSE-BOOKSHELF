import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPageAudioSegments,
  buildSelectionAudioSegments,
  getPageTextBlocks,
  resolveBookChapters,
  resolveChapterAndBlockIndex,
} from "./segments";
import {
  chunkTextForFreeTranslate,
  detectScriptLanguage,
} from "./freeTranslate";
import {
  chunkSpeechText,
  pickBestBrowserVoice,
  type BrowserVoiceInfo,
} from "./webSpeechTts";
import { REFLOW_MODEL_VERSION, type ReflowBook } from "../reader/types";

const SAMPLE_BOOK: ReflowBook = {
  version: REFLOW_MODEL_VERSION,
  bookId: "test-book-1",
  meta: {
    title: "The Mountain Road",
    author: "Test Author",
    totalPages: 3,
    scanned: false,
    dir: "ltr",
    language: "en",
  },
  blocks: [
    { id: "b0", page: 1, type: "heading", level: 1, text: "Chapter 1: Dawn", dir: "ltr" },
    { id: "b1", page: 1, type: "paragraph", text: "Sunrise warmed the quiet valley. Travellers packed their bags.", dir: "ltr" },
    { id: "b2", page: 2, type: "paragraph", text: "Page two begins cleanly at the stone bridge.", dir: "ltr" },
    { id: "b3", page: 2, type: "paragraph", text: "The river carried fallen leaves past the mill.", dir: "ltr" },
    { id: "b4", page: 3, type: "heading", level: 1, text: "Chapter 2: Summit", dir: "ltr" },
    { id: "b5", page: 3, type: "paragraph", text: "High above the clouds, the trail narrowed.", dir: "ltr" },
  ],
  chapters: [
    { id: "ch1", title: "Chapter 1: Dawn", blockIndex: 0, page: 1, level: 0 },
    { id: "ch2", title: "Chapter 2: Summit", blockIndex: 4, page: 3, level: 0 },
  ],
};

test("getPageTextBlocks collects exact blocks on requested page and falls back safely", () => {
  const page2 = getPageTextBlocks(SAMPLE_BOOK, 2);
  assert.equal(page2.length, 2);
  assert.deepEqual(
    page2.map((item) => item.block.id),
    ["b2", "b3"],
  );

  // Non-existent page falls back gracefully around fallbackStartBlockIndex
  const missingPage = getPageTextBlocks(SAMPLE_BOOK, 99, 4, 2);
  assert.equal(missingPage.length, 2);
  assert.equal(missingPage[0].block.id, "b4");
});

test("buildPageAudioSegments builds narrated segments strictly for that page and supports translatedMap", () => {
  const segs = buildPageAudioSegments({
    bookId: SAMPLE_BOOK.bookId,
    book: SAMPLE_BOOK,
    page: 2,
    language: "hi",
    voiceId: "Kore",
    style: "natural",
    translatedMap: {
      b2: "पृष्ठ दो पत्थर के पुल से शुरू होता है।",
      b3: "नदी गिरते पत्तों को चक्की के पास से बहा ले गई।",
    },
  });

  assert.equal(segs.length, 2);
  assert.equal(segs[0].blockId, "b2");
  assert.equal(segs[0].text, "पृष्ठ दो पत्थर के पुल से शुरू होता है।");
  assert.equal(segs[1].blockId, "b3");
  assert.equal(segs[1].language, "hi");
});

test("buildSelectionAudioSegments splits oversized excerpts without losing text", () => {
  const longExcerpt =
    "First sentence in selection. " +
    "Second sentence in selection adds detail. " +
    "Third sentence completes the thought cleanly.";

  const segs = buildSelectionAudioSegments({
    bookId: SAMPLE_BOOK.bookId,
    text: longExcerpt,
    language: "en",
    voiceId: "Kore",
    style: "natural",
    page: 2,
    maxCharsPerSegment: 60,
  });

  assert.ok(segs.length >= 2);
  assert.equal(segs.map((s) => s.text).join(" "), longExcerpt);
  assert.equal(segs[0].chapterId, "selection");
});

test("resolveChapterAndBlockIndex resolves accurate chapter and block indices from IDs", () => {
  const chapters = resolveBookChapters(SAMPLE_BOOK);
  const resolved = resolveChapterAndBlockIndex(SAMPLE_BOOK, chapters, undefined, "b5", 0);
  assert.equal(resolved.chapterIndex, 1);
  assert.equal(resolved.blockIndex, 5);
});

test("chunkSpeechText keeps chunks <= maxChars without slicing mid-word", () => {
  const longPara = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} flows smoothly across lines.`).join(" ");
  const chunks = chunkSpeechText(longPara, 120);
  assert.ok(chunks.length >= 4);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 120, `chunk exceeded maxChars: ${chunk.length}`);
  }
});

test("pickBestBrowserVoice prefers matching locale and natural voices over generic fallback", () => {
  const voices: BrowserVoiceInfo[] = [
    { voiceURI: "en-basic", name: "English Default", lang: "en-US", localService: true, default: true },
    { voiceURI: "hi-local", name: "Hindi Basic", lang: "hi-IN", localService: true, default: false },
    { voiceURI: "hi-natural", name: "Microsoft Madhur Online (Natural) - Hindi", lang: "hi-IN", localService: false, default: false },
  ];

  const pickedHi = pickBestBrowserVoice(voices, "hi");
  assert.equal(pickedHi?.voiceURI, "hi-natural");

  const forcedHi = pickBestBrowserVoice(voices, "hi", "hi-local");
  assert.equal(forcedHi?.voiceURI, "hi-local");
});

test("detectScriptLanguage identifies Hindi, Urdu, Arabic, Japanese, Russian, and English accurately", () => {
  assert.equal(detectScriptLanguage("यह एक बहुत अच्छी किताब है।").languageCode, "hi");
  assert.equal(detectScriptLanguage("یہ ایک بہت اچھی کتاب ہے جو ہمیں علم دیتی ہے۔").languageCode, "ur");
  assert.equal(detectScriptLanguage("هذا كتاب مفيد للقراءة اليومية.").languageCode, "ar");
  assert.equal(detectScriptLanguage("これは素晴らしい本です。毎日読みます。").languageCode, "ja");
  assert.equal(detectScriptLanguage("Это очень интересная книга.").languageCode, "ru");
  assert.equal(detectScriptLanguage("The calm river winds down the valley.").languageCode, "en");
});

test("chunkTextForFreeTranslate divides huge paragraphs within API size budget", () => {
  const huge = Array.from({ length: 50 }, (_, i) => `Paragraph sentence ${i + 1} ends here.`).join(" ");
  const chunks = chunkTextForFreeTranslate(huge, 400);
  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 400, `free translate chunk too long: ${chunk.length}`);
  }
});
