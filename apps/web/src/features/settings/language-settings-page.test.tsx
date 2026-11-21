import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineGlobalProperty } from "@/test/global-properties";

import { i18next, initUiLanguage } from "@/i18n/i18n";
import { resolveInitialLanguage, uiLanguageStorageKey } from "@/i18n/languages";

import { LanguageSettingsPage } from "./language-settings-page";

// This file switches the shared i18next instance, so every test starts from
// the shipped default again before the next file on this worker renders.
beforeEach(() => {
  void i18next.changeLanguage("en");
  document.documentElement.lang = "en";
  delete document.documentElement.dataset.hanFont;
  const values = new Map<string, string>();
  defineGlobalProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage,
  });
});

function renderPage() {
  return render(<LanguageSettingsPage />);
}

describe("LanguageSettingsPage", () => {
  it("renders English without a stored choice", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Language" })).toBeVisible();
    // The system option's row description joins its accessible name.
    expect(
      screen.getByRole("radio", { name: /System default/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "English" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      screen.getByRole("radio", { name: "\u7b80\u4f53\u4e2d\u6587" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.lang).toBe("en");
  });

  it("switches the interface to Simplified Chinese and saves the choice", () => {
    renderPage();
    fireEvent.click(
      screen.getByRole("radio", { name: "\u7b80\u4f53\u4e2d\u6587" }),
    );

    expect(screen.getByRole("heading", { name: "\u8bed\u8a00" })).toBeVisible();
    expect(
      screen.getByRole("radio", { name: /\u8ddf\u968f\u7cfb\u7edf/ }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("radio", { name: "\u7b80\u4f53\u4e2d\u6587" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(localStorage.getItem(uiLanguageStorageKey)).toBe("zh-CN");
    expect(document.documentElement.dataset.hanFont).toBe("sc");
  });

  it("follows the device again and clears the stored choice", () => {
    localStorage.setItem(uiLanguageStorageKey, "zh-CN");
    // App startup already applied the stored choice before Settings opened.
    initUiLanguage(resolveInitialLanguage([]));
    renderPage();
    expect(document.documentElement.lang).toBe("zh-CN");

    fireEvent.click(
      screen.getByRole("radio", { name: /\u8ddf\u968f\u7cfb\u7edf/ }),
    );

    // jsdom exposes no device language, so system resolves to English.
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem(uiLanguageStorageKey)).toBeNull();
    expect(document.documentElement.dataset.hanFont).toBeUndefined();
  });

  it("starts from a stored choice", () => {
    localStorage.setItem(uiLanguageStorageKey, "zh-CN");
    initUiLanguage(resolveInitialLanguage([]));
    renderPage();
    expect(screen.getByRole("heading", { name: "\u8bed\u8a00" })).toBeVisible();
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("tells the desktop shell about the choice when its bridge is present", () => {
    const set = vi.fn(() => Promise.resolve());
    defineGlobalProperty(window, "lingerDesktop", {
      configurable: true,
      value: { settings: { set } },
    });
    renderPage();

    fireEvent.click(
      screen.getByRole("radio", { name: "\u7b80\u4f53\u4e2d\u6587" }),
    );
    expect(set).toHaveBeenCalledWith({ language: "zh-CN" });

    fireEvent.click(
      screen.getByRole("radio", { name: /\u8ddf\u968f\u7cfb\u7edf/ }),
    );
    expect(set).toHaveBeenLastCalledWith({ language: null });
  });

  it("keeps the web choice when the desktop bridge is absent or fails", () => {
    const set = vi.fn(() => Promise.reject(new Error("bridge closed")));
    defineGlobalProperty(window, "lingerDesktop", {
      configurable: true,
      value: { settings: { set } },
    });
    renderPage();

    fireEvent.click(
      screen.getByRole("radio", { name: "\u7b80\u4f53\u4e2d\u6587" }),
    );

    expect(document.documentElement.lang).toBe("zh-CN");
    // The rejection settles after this test; keep the process quiet about it.
    set.mock.results[0]?.value.catch(() => {});
  });
});
