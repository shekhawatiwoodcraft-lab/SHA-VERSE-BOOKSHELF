import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChapterAudioSegments,
  parseModelJson,
  splitIntoSentences,
  validateTranslationBatch,
} from "./segments";
import type { Chapter, Block } from "../reader/types";

test("parseModelJson strips markdown code fences before parsing", () => {
  const parsed = parseModelJson<{ items: Array<{ id: string; translatedText: string }> }>(
    '```json\n{"items":[{"id":"b1","translatedText":"नमस्ते"}]}\n```',
  );
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].translatedText, "नमस्ते");
});

test("buildChapterAudioSegments paragraph mode coalesces paragraphs and chunks oversized ones", () => {
  const chapter: Chapter = { id: "ch1", title: "Ch 1", blockIndex: 0, page: 1, level: 0 };
  const blocks: Block[] = [
    { id: "h1", page: 1, type: "heading", level: 1, text: "Chapter One", dir: "ltr" },
    {
      id: "p1",
      page: 1,
      type: "paragraph",
      text: "First short sentence here. Second sentence follows immediately.",
      dir: "ltr",
    },
  ];

  const singleSegs = buildChapterAudioSegments({
    bookId: "b1",
    chapter,
    blocks,
    startIndex: 0,
    endIndex: blocks.length,
    language: "en",
    voiceId: "Kore",
    style: "natural",
    mode: "paragraph",
    maxCharsPerSegment: 850,
  });

  assert.equal(singleSegs.length, 2);
  assert.equal(singleSegs[1].text, "First short sentence here. Second sentence follows immediately.");
  assert.equal(singleSegs[1].sentenceIndex, -1);

  const splitSegs = buildChapterAudioSegments({
    bookId: "b1",
    chapter,
    blocks,
    startIndex: 0,
    endIndex: blocks.length,
    language: "en",
    voiceId: "Kore",
    style: "natural",
    mode: "paragraph",
    maxCharsPerSegment: 30,
  });

  const p1Parts = splitSegs.filter((s) => s.blockId === "p1");
  assert.equal(p1Parts.length, 2);
  assert.equal(p1Parts[0].sentenceIndex, 0);
  assert.equal(p1Parts[1].sentenceIndex, 1);
  assert.equal(p1Parts[0].charStart, 0);
  assert.equal(p1Parts[1].charEnd, blocks[1].type === "paragraph" ? blocks[1].text.length : 0);
});

test("splitIntoSentences and validateTranslationBatch preserve 1-to-1 block mapping", () => {
  const spans = splitIntoSentences("One sentence. Two sentences!");
  assert.equal(spans.length, 2);

  const check = validateTranslationBatch(
    [{ id: "b1", text: "One" }],
    [{ id: "b1", translatedText: "एक" }],
  );
  assert.equal(check.valid, true);
  assert.equal(check.map.b1, "एक");
});
