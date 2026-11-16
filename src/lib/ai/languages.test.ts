import { describe, expect, it } from "vitest";
import {
  SUPPORTED_LANGUAGES,
  VOICE_LIBRARY,
  filterSupportedLanguages,
  getLanguageMeta,
  isRtlLanguage,
} from "./languages";

describe("A-Z language catalog and 18-voice library", () => {
  it("keeps SUPPORTED_LANGUAGES sorted alphabetically A to Z with broad global coverage", () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(80);
    const names = SUPPORTED_LANGUAGES.map((l) => l.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
    expect(names[0]).toBe("Afrikaans");
    expect(names[names.length - 1]).toBe("Zulu");
  });

  it("filters languages cleanly across name, nativeName, and code", () => {
    expect(filterSupportedLanguages("urdu").map((l) => l.code)).toContain("ur");
    expect(filterSupportedLanguages("हिन्दी").map((l) => l.code)).toContain("hi");
    expect(filterSupportedLanguages("es").some((l) => l.code === "es")).toBe(true);
  });

  it("detects RTL direction accurately", () => {
    expect(isRtlLanguage("ur")).toBe(true);
    expect(isRtlLanguage("ar")).toBe(true);
    expect(isRtlLanguage("fa")).toBe(true);
    expect(isRtlLanguage("en")).toBe(false);
    expect(getLanguageMeta("hi").dir).toBe("ltr");
  });

  it("provides 15 to 20 unique voices each with an example quote", () => {
    expect(VOICE_LIBRARY.length).toBeGreaterThanOrEqual(15);
    expect(VOICE_LIBRARY.length).toBeLessThanOrEqual(20);
    const ids = new Set(VOICE_LIBRARY.map((v) => v.id));
    expect(ids.size).toBe(VOICE_LIBRARY.length);
    for (const voice of VOICE_LIBRARY) {
      expect(voice.exampleText.trim().length).toBeGreaterThan(15);
      expect(voice.timbre.trim().length).toBeGreaterThan(4);
    }
  });
});
