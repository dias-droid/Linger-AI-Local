import type { UiLanguage } from "../../shared/api.js";

import shellDict from "../../i18n/locales/zh-CN/shell.json" with { type: "json" };

// The catalog nests by page for review; the pages look keys up flat.
const flatten = (
  value: Record<string, unknown>,
  prefix = "",
): Record<string, string> => {
  const flat: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof child === "string") flat[path] = child;
    else Object.assign(flat, flatten(child as Record<string, unknown>, path));
  }
  return flat;
};

// The one dictionary the shell pages translate from; the English text stays
// in the pages themselves as each string's fallback.
export const shellDictionary: Record<string, string> = flatten(shellDict);

// The shell pages (setup, offline, titlebar) are plain HTML with inline
// scripts that cannot import modules. The main process — which owns the
// language — injects this bootstrap before the page's own script when the
// language is not English; English pages are served byte-identical to their
// source, which the setup page tests re-run.
const BOOTSTRAP = `(() => {
  const dict = window.LINGER_I18N_DICT;
  // The lookup only; the page's own T() fills {placeholders} so English
  // pages without this bootstrap substitute them the same way.
  const t = (key, fallback) => (dict[key] != null ? dict[key] : fallback);
  window.LINGER_I18N = { lang: window.LINGER_I18N_LANG, t };
  document.documentElement.lang = window.LINGER_I18N_LANG;
  const apply = () => {
    for (const el of document.querySelectorAll("[data-i18n]"))
      el.textContent = t(el.dataset.i18n, el.textContent);
    for (const el of document.querySelectorAll("[data-i18n-title]"))
      el.title = t(el.dataset.i18nTitle, el.title);
    for (const el of document.querySelectorAll("[data-i18n-aria-label]"))
      el.setAttribute(
        "aria-label",
        t(el.dataset.i18nAriaLabel, el.getAttribute("aria-label")),
      );
    for (const el of document.querySelectorAll("[data-i18n-placeholder]"))
      el.setAttribute(
        "placeholder",
        t(el.dataset.i18nPlaceholder, el.getAttribute("placeholder")),
      );
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", apply);
  else apply();
})();`;

/**
 * Localizes a shell page: the dictionary lands on `window.LINGER_I18N_DICT`,
 * the bootstrap defines `window.LINGER_I18N.t(key, fallback, parts)` and
 * applies the `data-i18n*` attributes before the page's script runs. English
 * pages pass through untouched, so tests and served bytes stay identical.
 */
export function injectShellI18n(
  html: string,
  language: UiLanguage,
  dict: Record<string, string>,
): string {
  if (language === "en") return html;
  const bootstrap = `<script>window.LINGER_I18N_LANG=${JSON.stringify(
    language,
  )};window.LINGER_I18N_DICT=${JSON.stringify(dict)};${BOOTSTRAP}</script>`;
  const at = html.indexOf("<script>");
  if (at < 0) return html + bootstrap;
  return html.slice(0, at) + bootstrap + html.slice(at);
}
