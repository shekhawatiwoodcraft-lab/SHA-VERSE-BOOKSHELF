import test from "node:test";
import assert from "node:assert/strict";
import { buildAiApiUrl, normalizeApiBaseUrl, resolveCorsOrigin } from "./apiBase";

test("normalizeApiBaseUrl strips trailing slashes and blocks unsafe schemes", () => {
  assert.equal(normalizeApiBaseUrl(undefined), "");
  assert.equal(normalizeApiBaseUrl(""), "");
  assert.equal(normalizeApiBaseUrl("https://api.shaverse.example/"), "https://api.shaverse.example");
  assert.equal(normalizeApiBaseUrl("https://api.shaverse.example/v1///"), "https://api.shaverse.example/v1");
  assert.equal(normalizeApiBaseUrl("javascript:alert(1)"), "");
  assert.equal(normalizeApiBaseUrl("not-a-url"), "");
});

test("buildAiApiUrl keeps relative paths on web and prefixes configured base URL", () => {
  assert.equal(buildAiApiUrl("/api/ai/translate", ""), "/api/ai/translate");
  assert.equal(
    buildAiApiUrl("api/ai/tts", "https://api.shaverse.example/"),
    "https://api.shaverse.example/api/ai/tts",
  );
});

test("resolveCorsOrigin permits Capacitor and configured origins without wildcard", () => {
  assert.equal(resolveCorsOrigin("https://localhost"), "https://localhost");
  assert.equal(resolveCorsOrigin("capacitor://localhost"), "capacitor://localhost");
  assert.equal(resolveCorsOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(
    resolveCorsOrigin("https://bookshelf.shaverse.com", "https://bookshelf.shaverse.com/app"),
    "https://bookshelf.shaverse.com",
  );
  assert.equal(
    resolveCorsOrigin("https://preview.example.com", undefined, "https://a.com, https://preview.example.com"),
    "https://preview.example.com",
  );
  assert.equal(resolveCorsOrigin("https://untrusted.example.com"), null);
  assert.equal(resolveCorsOrigin("null"), null);
});
