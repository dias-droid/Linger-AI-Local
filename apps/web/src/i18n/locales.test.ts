import { describe, expect, it } from "vitest";

import { uiLanguages } from "./languages";
import enCommon from "./locales/en/common.json";
import enSettings from "./locales/en/settings.json";
import languageNames from "./locales/language-names.json";
import zhCNCommon from "./locales/zh-CN/common.json";
import zhCNSettings from "./locales/zh-CN/settings.json";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function leafPaths(value: JsonValue, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

function hasEmptyLeaf(value: JsonValue): boolean {
  if (typeof value === "string") return value.trim() === "";
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).some(hasEmptyLeaf);
}

import enApps from "./locales/en/apps.json";
import enAuth from "./locales/en/auth.json";
import enLibrary from "./locales/en/library.json";
import enRooms from "./locales/en/rooms.json";
import enWiki from "./locales/en/wiki.json";

import zhCNApps from "./locales/zh-CN/apps.json";
import zhCNAuth from "./locales/zh-CN/auth.json";
import zhCNLibrary from "./locales/zh-CN/library.json";
import zhCNRooms from "./locales/zh-CN/rooms.json";
import zhCNWiki from "./locales/zh-CN/wiki.json";

describe("translation catalogs", () => {
  const namespaces = [
    ["settings", enSettings, zhCNSettings],
    ["common", enCommon, zhCNCommon],
    ["auth", enAuth, zhCNAuth],
    ["apps", enApps, zhCNApps],
    ["library", enLibrary, zhCNLibrary],
    ["wiki", enWiki, zhCNWiki],
    ["rooms", enRooms, zhCNRooms],
  ] as const;

  it.each(namespaces)("keeps zh-CN %s at key parity with en", (_, en, zh) => {
    expect(leafPaths(zh as JsonValue).sort()).toEqual(
      leafPaths(en as JsonValue).sort(),
    );
  });

  it.each(namespaces)("keeps zh-CN %s values non-empty", (_, en, zh) => {
    expect(hasEmptyLeaf(en as JsonValue)).toBe(false);
    expect(hasEmptyLeaf(zh as JsonValue)).toBe(false);
  });

  it("keeps en free of untranslated placeholders", () => {
    for (const [, en] of namespaces) {
      expect(JSON.stringify(en)).not.toContain("TODO");
    }
  });

  it("names every shipped language", () => {
    expect(Object.keys(languageNames).sort()).toEqual([...uiLanguages].sort());
  });
});
