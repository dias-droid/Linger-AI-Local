// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { injectShellI18n, shellDictionary } from "./shell-html.js";

const titlebar = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../shell/titlebar.html",
  ),
  "utf8",
);

describe("injectShellI18n", () => {
  it("serves English pages byte-identical", () => {
    expect(injectShellI18n(titlebar, "en", shellDictionary)).toBe(titlebar);
  });

  it("localizes static text, titles, aria-labels and placeholders", () => {
    const html = `<!doctype html><html lang="en"><body>
      <h1 data-i18n="offline.cantReach">Can't reach the server</h1>
      <button title="Back" aria-label="Back" data-i18n-title="titlebar.back" data-i18n-aria-label="titlebar.back">Go</button>
      <input placeholder="Paste the code" data-i18n-placeholder="setup.pasteTheCode" />
      <span data-i18n="setup.offlineMissingKey">Fallback stays</span>
    </body></html>`;
    const localized = injectShellI18n(html, "zh-CN", shellDictionary);
    const [, bootstrap] = /<script>([\s\S]*?)<\/script>/.exec(localized)!;
    // As served: the markup is parsed first, the injected bootstrap runs
    // before the page's own scripts.
    document.documentElement.innerHTML = localized.replace(
      /<script>[\s\S]*?<\/script>/,
      "",
    );
    new Function(bootstrap!)();
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.querySelector("h1")!.textContent).toBe(
      "\u65e0\u6cd5\u8fde\u63a5\u670d\u52a1\u5668",
    );
    const button = document.querySelector("button")!;
    expect(button.title).toBe("\u540e\u9000");
    expect(button.getAttribute("aria-label")).toBe("\u540e\u9000");
    expect(
      (document.querySelector("input") as HTMLInputElement).placeholder,
    ).toBe("\u7c98\u8d34\u4ee3\u7801");
    // A key missing from the dictionary keeps the page's English text.
    expect(document.querySelector("span")!.textContent).toBe("Fallback stays");
  });

  it("leaves the document alone for an unknown language", () => {
    const localized = injectShellI18n(titlebar, "en", {});
    expect(localized).toBe(titlebar);
  });
});
