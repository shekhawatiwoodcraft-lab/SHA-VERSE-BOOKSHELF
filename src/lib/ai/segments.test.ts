import { describe, it, expect } from "vitest";
import {
  buildChapterAudioSegments,
  detectDialogueParts,
  extractCandidateGlossaryTerms,
  hashTextContent,
  resolveBookChapters,
  splitIntoSentences,
  validateTranslationBatch,
} from "@/lib/ai/segments";
import {
  SUPPORTED_LANGUAGES,
  filterSupportedLanguages,
  getLanguageMeta,
  isRtlLanguage,
} from "@/lib/ai/languages";
import type { ReflowBook } from "@/lib/reader/types";

describe("AI language registry & direction helpers", () => {
  it("recognizes LTR and RTL languages reliably", () => {
    expect(isRtlLanguage("ur")).toBe(true);
    expect(isRtlLanguage("ar")).toBe(true);
    expect(isRtlLanguage("ur-PK")).toBe(true);
    expect(isRtlLanguage("hi")).toBe(false);
    expect(isRtlLanguage("en")).toBe(false);
    expect(getLanguageMeta("hi").nativeName).toBe("हिन्दी");
  });

  it("filters supported languages by English name, native script, or ISO code", () => {
    expect(filterSupportedLanguages("urdu").map((l) => l.code)).toContain("ur");
    expect(filterSupportedLanguages("हिन्दी").map((l) => l.code)).toContain("hi");
    expect(filterSupportedLanguages("ja").map((l) => l.code)).toContain("ja");
    expect(filterSupportedLanguages("").length).toBe(SUPPORTED_LANGUAGES.length);
  });
});

describe("AI sentence & dialogue segmentation", () => {
  it("splits English sentences while preserving decimals and abbreviations", () => {
    const text = "Dr. Sharma measured 3.14 liters carefully. Then he smiled! Did it work?";
    const spans = splitIntoSentences(text);
    expect(spans).toHaveLength(3);
    expect(spans[0].text).toBe("Dr. Sharma measured 3.14 liters carefully.");
    expect(spans[1].text).toBe("Then he smiled!");
    expect(spans[2].text).toBe("Did it work?");
  });

  it("handles Hindi Devanagari, Urdu/Arabic, and Japanese punctuation cleanly", () => {
    const hi = splitIntoSentences("यह पहली पंक्ति है। यह दूसरी पंक्ति है।");
    expect(hi).toHaveLength(2);

    const ur = splitIntoSentences("یہ پہلا جملہ ہے۔ کیا آپ تیار ہیں؟");
    expect(ur).toHaveLength(2);

    const ja = splitIntoSentences("最初の文です。次の文です！");
    expect(ja).toHaveLength(2);
  });

  it("splits quoted dialogue from narration when utterance >= 8 chars", () => {
    const parts = detectDialogueParts('Mira whispered softly, "Meet me at dawn by the river gate." and walked away.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ speaker: "Narrator", text: "Mira whispered softly," });
    expect(parts[1]).toEqual({ speaker: "Speaker", text: '"Meet me at dawn by the river gate."' });
    expect(parts[2]).toEqual({ speaker: "Narrator", text: "and walked away." });
  });

  it("keeps pure narrative without long quotes as single Narrator turn", () => {
    const parts = detectDialogueParts("The rain fell steadily over the quiet valley.");
    expect(parts).toEqual([{ speaker: "Narrator", text: "The rain fell steadily over the quiet valley." }]);
  });
});

describe("Chapter resolution, audio alignment & translation validation", () => {
  const sampleBook: ReflowBook = {
    version: 6,
    bookId: "b1",
    meta: { title: "River Gate", author: "A. Author", totalPages: 2, scanned: false, dir: "ltr" },
    blocks: [
      { id: "b0", page: 1, type: "heading", level: 1, text: "Chapter One", dir: "ltr" },
      { id: "b1", page: 1, type: "paragraph", text: "Aarav entered Kashi at sunrise. Birds sang.", dir: "ltr" },
      { id: "b2", page: 2, type: "paragraph", text: "Aarav met Tara in Kashi near the steps.", dir: "ltr" },
    ],
    chapters: [{ id: "ch1", title: "Chapter One", blockIndex: 0, page: 1, level: 0 }],
  };

  it("builds translated audio segments when translatedMap is supplied", () => {
    const segments = buildChapterAudioSegments({
      bookId: "b1",
      chapter: sampleBook.chapters[0],
      blocks: sampleBook.blocks,
      startIndex: 0,
      endIndex: sampleBook.blocks.length,
      language: "hi",
      voiceId: "Kore",
      style: "natural",
      translatedMap: {
        b0: "अध्याय एक",
        b1: "आरव सूर्योदय के समय काशी पहुँचा। पक्षियों ने गीत गाया।",
      },
    });
    expect(segments[0].text).toBe("अध्याय एक");
    expect(segments[0].language).toBe("hi");
    expect(segments[1].text).toBe("आरव सूर्योदय के समय काशी पहुँचा।");
    expect(segments[2].text).toBe("पक्षियों ने गीत गाया।");
    expect(hashTextContent("abc")).toBe(hashTextContent("abc"));
  });

  it("synthesizes fallback chapters when PDF outline is empty", () => {
    const outlineFree: ReflowBook = { ...sampleBook, chapters: [] };
    const chapters = resolveBookChapters(outlineFree);
    expect(chapters.length).toBeGreaterThanOrEqual(1);
    expect(chapters[0].title).toBe("River Gate");
  });

  it("extracts recurring capitalized proper nouns for translation glossary", () => {
    const terms = extractCandidateGlossaryTerms(sampleBook.blocks);
    expect(terms).toContain("Aarav");
    expect(terms).toContain("Kashi");
  });

  it("validates 1-to-1 batch translation completeness", () => {
    const ok = validateTranslationBatch(
      [
        { id: "b0", text: "Hello" },
        { id: "b1", text: "World" },
      ],
      [
        { id: "b0", translatedText: "नमस्ते" },
        { id: "b1", translatedText: "दुनिया" },
      ],
    );
    expect(ok.valid).toBe(true);
    expect(ok.map.b0).toBe("नमस्ते");

    const bad = validateTranslationBatch(
      [
        { id: "b0", text: "Hello" },
        { id: "b1", text: "World" },
      ],
      [{ id: "b0", translatedText: "नमस्ते" }],
    );
    expect(bad.valid).toBe(false);
  });
});
