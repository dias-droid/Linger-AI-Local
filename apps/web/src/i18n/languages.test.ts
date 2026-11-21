// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  readStoredLanguageChoice,
  resolveInitialLanguage,
  resolveLanguageFromChoice,
  storeLanguageChoice,
  uiLanguageNames,
  uiLanguageStorageKey,
} from "./languages";

afterEach(() => {
  localStorage.removeItem(uiLanguageStorageKey);
});

describe("readStoredLanguageChoice", () => {
  it("reads a saved choice", () => {
    localStorage.setItem(uiLanguageStorageKey, "zh-CN");
    expect(readStoredLanguageChoice()).toBe("zh-CN");
    localStorage.setItem(uiLanguageStorageKey, "system");
    expect(readStoredLanguageChoice()).toBe("system");
  });

  it.each(["fr", "zh-TW", "", "null"])(
    "falls back to system for the stored value %j",
    (stored) => {
      localStorage.setItem(uiLanguageStorageKey, stored);
      expect(readStoredLanguageChoice()).toBe("system");
    },
  );

  it("falls back to system without storage", () => {
    expect(readStoredLanguageChoice()).toBe("system");
  });
});

describe("storeLanguageChoice", () => {
  it("stores a language and clears it for system", () => {
    storeLanguageChoice("zh-CN");
    expect(localStorage.getItem(uiLanguageStorageKey)).toBe("zh-CN");
    storeLanguageChoice("system");
    expect(localStorage.getItem(uiLanguageStorageKey)).toBeNull();
  });
});

describe("resolveLanguageFromChoice", () => {
  it("pins an explicit language", () => {
    expect(resolveLanguageFromChoice("en", ["zh-CN"])).toBe("en");
    expect(resolveLanguageFromChoice("zh-CN", ["en"])).toBe("zh-CN");
  });

  it.each([
    [["zh"], "zh-CN"],
    [["en-US", "zh-CN", "en"], "zh-CN"],
    [["zh-Hans"], "zh-CN"],
  ])("follows a Simplified Chinese device language %j", (languages, want) => {
    expect(resolveLanguageFromChoice("system", languages)).toBe(want);
  });

  it.each([
    [["en-US"], "en"],
    [["zh-TW", "zh-HK"], "en"],
    [[], "en"],
  ])("stays English for %j", (languages, want) => {
    expect(resolveLanguageFromChoice("system", languages)).toBe(want);
  });
});

describe("resolveInitialLanguage", () => {
  it("prefers the stored choice over the device languages", () => {
    localStorage.setItem(uiLanguageStorageKey, "en");
    expect(resolveInitialLanguage(["zh-CN"])).toBe("en");
    localStorage.setItem(uiLanguageStorageKey, "zh-CN");
    expect(resolveInitialLanguage(["en-US"])).toBe("zh-CN");
  });

  it("follows the device languages under system", () => {
    expect(resolveInitialLanguage(["zh-SG"])).toBe("zh-CN");
    expect(resolveInitialLanguage(["en-US"])).toBe("en");
  });
});

describe("uiLanguageNames", () => {
  it("names every language in its own language", () => {
    expect(uiLanguageNames.en).toBe("English");
    expect(uiLanguageNames["zh-CN"]).toBe("\u7b80\u4f53\u4e2d\u6587");
  });
});
