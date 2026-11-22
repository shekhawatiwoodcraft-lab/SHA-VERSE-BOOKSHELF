import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_OWNER_EMAIL,
  isOwnerEmail,
  resolveEffectiveUploadMode,
} from "./uploadAccess";

test("isOwnerEmail matches designated app owner email case-insensitively", () => {
  assert.equal(isOwnerEmail(APP_OWNER_EMAIL), true);
  assert.equal(isOwnerEmail("  ShashaAITeam@Gmail.com "), true);
  assert.equal(isOwnerEmail("reader@example.com"), false);
  assert.equal(isOwnerEmail(null), false);
});

test("resolveEffectiveUploadMode restricts bulk mode exclusively to app owner", () => {
  assert.equal(resolveEffectiveUploadMode("bulk", false), "single");
  assert.equal(resolveEffectiveUploadMode("single", false), "single");
  assert.equal(resolveEffectiveUploadMode("bulk", true), "bulk");
  assert.equal(resolveEffectiveUploadMode("single", true), "single");
});
