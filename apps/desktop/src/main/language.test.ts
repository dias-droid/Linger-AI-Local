import { describe, expect, it } from "vitest";

import {
  LanguageModule,
  localeToUiLanguage,
  resolveLanguage,
} from "./language.js";
import type { ModuleContext } from "./modules.js";

const context = (stored: "en" | "zh-CN" | undefined) => {
  const updates: Record<string, unknown>[] = [];
  const emitted: string[] = [];
  const ctx = {
    config: {
      get: () => ({ language: stored }),
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
      },
    },
    bus: {
      emit: (_event: "language.changed", language: "en" | "zh-CN") => {
        emitted.push(language);
      },
    },
  } as unknown as ModuleContext;
  return { ctx, updates, emitted };
};

describe("localeToUiLanguage", () => {
  it.each(["zh", "zh-CN", "zh_CN", "zh-Hans-TW", "zh-TW"])(
    "reads %s as Simplified Chinese",
    (locale) => {
      expect(localeToUiLanguage(locale)).toBe("zh-CN");
    },
  );

  it.each(["en", "en-US", "ja", "fr-CA", ""])(
    "reads %s as English",
    (locale) => {
      expect(localeToUiLanguage(locale)).toBe("en");
    },
  );
});

describe("resolveLanguage", () => {
  it("prefers the stored choice over the device locale", () => {
    expect(resolveLanguage("en", "zh-CN")).toBe("en");
    expect(resolveLanguage("zh-CN", "en-US")).toBe("zh-CN");
  });

  it("follows the device without a stored choice", () => {
    expect(resolveLanguage(undefined, "zh")).toBe("zh-CN");
    expect(resolveLanguage(undefined, "en-US")).toBe("en");
  });
});

describe("LanguageModule", () => {
  it("resolves the device language at start", async () => {
    const module = new LanguageModule({ deviceLocale: () => "zh-CN" });
    await module.start(context(undefined).ctx);
    expect(module.current()).toBe("zh-CN");

    const english = new LanguageModule({ deviceLocale: () => "en-US" });
    await english.start(context(undefined).ctx);
    expect(english.current()).toBe("en");
  });

  it("persists a choice and announces it", async () => {
    const { ctx, updates, emitted } = context(undefined);
    const module = new LanguageModule({ deviceLocale: () => "en-US" });
    await module.start(ctx);

    expect(module.set("zh-CN")).toBe("zh-CN");
    expect(module.current()).toBe("zh-CN");
    expect(updates).toEqual([{ language: "zh-CN" }]);
    expect(emitted).toEqual(["zh-CN"]);
  });

  it("clears the stored choice and follows the device again on null", async () => {
    const { ctx, updates, emitted } = context("zh-CN");
    const module = new LanguageModule({ deviceLocale: () => "en-US" });
    await module.start(ctx);
    expect(module.current()).toBe("zh-CN");

    expect(module.set(null)).toBe("en");
    // An absent key drops the override from the config file.
    expect(updates).toEqual([{ language: undefined }]);
    expect(emitted).toEqual(["en"]);
  });
});
