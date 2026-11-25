import test from "node:test";
import assert from "node:assert/strict";
import { resolveSafeImageUploadMeta } from "./uploadMeta";

test("resolveSafeImageUploadMeta handles Android extensionless filenames using MIME type", () => {
  assert.deepEqual(
    resolveSafeImageUploadMeta({ name: "image", type: "image/jpeg" }),
    { ext: "jpg", contentType: "image/jpeg" },
  );
  assert.deepEqual(
    resolveSafeImageUploadMeta({ name: "1000048192", type: "image/webp" }),
    { ext: "webp", contentType: "image/webp" },
  );
  assert.deepEqual(
    resolveSafeImageUploadMeta({ name: "cover.png", type: "image/png" }),
    { ext: "png", contentType: "image/png" },
  );
  assert.deepEqual(
    resolveSafeImageUploadMeta({ name: "photo", type: "" }),
    { ext: "jpg", contentType: "image/jpeg" },
  );
});
