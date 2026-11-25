import test from "node:test";
import assert from "node:assert/strict";
import {
  READER_AUDIO_TRANSLATION_HIDDEN,
  getVisibleReaderSettingsTabs,
  resolveActiveSettingsTab,
} from "./featureFlags";

test("READER_AUDIO_TRANSLATION_HIDDEN hides audio and translation UI while preserving restore path", () => {
  assert.equal(READER_AUDIO_TRANSLATION_HIDDEN, true);

  assert.deepEqual(getVisibleReaderSettingsTabs(true), [
    { id: "appearance", label: "Appearance" },
  ]);
  assert.deepEqual(getVisibleReaderSettingsTabs(false), [
    { id: "appearance", label: "Appearance" },
    { id: "translation", label: "Translation" },
    { id: "audio", label: "Audio Reader" },
  ]);

  assert.equal(resolveActiveSettingsTab("audio", true), "appearance");
  assert.equal(resolveActiveSettingsTab("translation", true), "appearance");
  assert.equal(resolveActiveSettingsTab("audio", false), "audio");
  assert.equal(resolveActiveSettingsTab("translation", false), "translation");
});
