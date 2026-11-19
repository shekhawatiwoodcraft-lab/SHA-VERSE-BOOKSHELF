import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SUPABASE_PUBLISHABLE_KEY,
  DEFAULT_SUPABASE_URL,
  isSchemaMissingError,
  normalizeSupabaseUrl,
  resolveSupabaseConfig,
  shouldRetryQuery,
} from "./config";

test("normalizeSupabaseUrl strips /rest/v1/ and trailing slashes", () => {
  assert.equal(
    normalizeSupabaseUrl("https://gkmyhgebjqkdvjzgbrhr.supabase.co/rest/v1/"),
    "https://gkmyhgebjqkdvjzgbrhr.supabase.co",
  );
  assert.equal(
    normalizeSupabaseUrl("https://gkmyhgebjqkdvjzgbrhr.supabase.co/rest/v1"),
    "https://gkmyhgebjqkdvjzgbrhr.supabase.co",
  );
  assert.equal(
    normalizeSupabaseUrl("https://gkmyhgebjqkdvjzgbrhr.supabase.co///"),
    "https://gkmyhgebjqkdvjzgbrhr.supabase.co",
  );
});

test("normalizeSupabaseUrl rejects legacy disconnected project URL", () => {
  assert.equal(
    normalizeSupabaseUrl("https://plmhjuqedtkiffzhberf.supabase.co"),
    "",
  );
  assert.equal(
    normalizeSupabaseUrl("https://plmhjuqedtkiffzhberf.supabase.co/rest/v1/"),
    "",
  );
});

test("resolveSupabaseConfig falls back to new backend when env is empty or legacy", () => {
  const clean = resolveSupabaseConfig({ url: "", key: "" });
  assert.equal(clean.url, DEFAULT_SUPABASE_URL);
  assert.equal(clean.publishableKey, DEFAULT_SUPABASE_PUBLISHABLE_KEY);
  assert.equal(clean.projectRef, "gkmyhgebjqkdvjzgbrhr");

  const legacy = resolveSupabaseConfig({
    url: "https://plmhjuqedtkiffzhberf.supabase.co",
    key: "old-key",
  });
  assert.equal(legacy.url, DEFAULT_SUPABASE_URL);
  assert.equal(legacy.publishableKey, DEFAULT_SUPABASE_PUBLISHABLE_KEY);
});

test("isSchemaMissingError detects PGRST205 and shouldRetryQuery stops retries", () => {
  const pgrst205 = {
    code: "PGRST205",
    details: null,
    hint: null,
    message: "Could not find the table 'public.channels' in the schema cache",
  };
  assert.equal(isSchemaMissingError(pgrst205), true);
  assert.equal(shouldRetryQuery(0, pgrst205), false);
  assert.equal(shouldRetryQuery(0, { status: 404 }), false);
  assert.equal(shouldRetryQuery(0, { status: 500 }), true);
  assert.equal(shouldRetryQuery(2, { status: 500 }), false);
  assert.equal(isSchemaMissingError(new Error("network timeout")), false);
});
