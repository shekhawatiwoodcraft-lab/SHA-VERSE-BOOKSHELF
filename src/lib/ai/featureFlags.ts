/**
 * READER AI AUDIO & TRANSLATION VISIBILITY SWITCH
 *
 * Set to `true`  → ALL Audio & Translation UI options are completely hidden
 *                  when opening or reading books (settings tabs, More Tools,
 *                  paragraph Listen/Translate icons, selection Listen/Translate
 *                  actions, AudiobookPlayer dock, and MiniAudioPlayer).
 * Set to `false` → Everything restores and works identically as before.
 *
 * This ONLY controls UI visibility. Zero underlying logic, hooks, caches,
 * or components are removed or altered.
 */
export const READER_AUDIO_TRANSLATION_HIDDEN = true;

export type ReaderSettingsTab = "appearance" | "translation" | "audio";

export function getVisibleReaderSettingsTabs(
  hidden = READER_AUDIO_TRANSLATION_HIDDEN,
): ReadonlyArray<{ id: ReaderSettingsTab; label: string }> {
  if (hidden) {
    return [{ id: "appearance", label: "Appearance" }];
  }
  return [
    { id: "appearance", label: "Appearance" },
    { id: "translation", label: "Translation" },
    { id: "audio", label: "Audio Reader" },
  ];
}

export function resolveActiveSettingsTab(
  requestedTab: ReaderSettingsTab,
  hidden = READER_AUDIO_TRANSLATION_HIDDEN,
): ReaderSettingsTab {
  return hidden ? "appearance" : requestedTab;
}
