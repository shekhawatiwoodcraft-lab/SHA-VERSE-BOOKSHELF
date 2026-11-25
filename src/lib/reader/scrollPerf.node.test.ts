import test from "node:test";
import assert from "node:assert/strict";
import { findFirstVisibleBlockIndex, hasPaginationChanged } from "./scrollPerf";

test("findFirstVisibleBlockIndex locates first block visible at or below viewportTop", () => {
  const tops = [0, 120, 240, 360, 480, 600, 720, 840];
  const getBounds = (i: number) => ({ top: tops[i], bottom: tops[i] + 100 });

  assert.equal(findFirstVisibleBlockIndex(0, getBounds, 100), -1);
  assert.equal(findFirstVisibleBlockIndex(tops.length, getBounds, 0), 0);
  assert.equal(findFirstVisibleBlockIndex(tops.length, getBounds, 95), 0);
  assert.equal(findFirstVisibleBlockIndex(tops.length, getBounds, 105), 1);
  assert.equal(findFirstVisibleBlockIndex(tops.length, getBounds, 400), 3);
  assert.equal(findFirstVisibleBlockIndex(tops.length, getBounds, 9999), 0);
});

test("hasPaginationChanged deduplicates identical pagination snapshots", () => {
  const base = { page: 4, totalPages: 42, percent: 8, chapterTitle: "Chapter I" };
  assert.equal(hasPaginationChanged(null, base), true);
  assert.equal(hasPaginationChanged(base, { ...base }), false);
  assert.equal(hasPaginationChanged(base, { ...base, page: 5 }), true);
  assert.equal(hasPaginationChanged(base, { ...base, chapterTitle: "Chapter II" }), true);
});
