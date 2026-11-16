import { describe, it, expect, beforeEach } from "vitest";
import {
  shouldRecordSessionView,
  markSessionViewRecorded,
  resetViewTrackingMemoryForTests,
  createIdempotencyKey,
} from "./tracking";

function createMemoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe("analytics tracking deduplication", () => {
  beforeEach(() => {
    resetViewTrackingMemoryForTests();
  });

  it("prevents duplicate view counts within the 30-minute session window", () => {
    const storage = createMemoryStorage();
    const t0 = 1_700_000_000_000;

    expect(shouldRecordSessionView("book-1", t0, storage)).toBe(true);
    markSessionViewRecorded("book-1", t0, storage);

    // Same session 10 seconds later must NOT recount
    expect(shouldRecordSessionView("book-1", t0 + 10_000, storage)).toBe(false);

    // Different book in same session SHOULD count independently
    expect(shouldRecordSessionView("book-2", t0 + 10_000, storage)).toBe(true);

    // After 31 minutes, a new session view is allowed
    expect(shouldRecordSessionView("book-1", t0 + 31 * 60 * 1000, storage)).toBe(true);
  });

  it("generates unique idempotency keys per operation", () => {
    const k1 = createIdempotencyKey("download", "book-1");
    const k2 = createIdempotencyKey("download", "book-1");
    expect(k1).not.toBe(k2);
    expect(k1.startsWith("download:book-1:")).toBe(true);
  });
});
