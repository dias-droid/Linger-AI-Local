import i18next from "i18next";

import type { UiLanguage } from "../shared/api.js";

import enMain from "./locales/en/main.json" with { type: "json" };
import zhCNMain from "./locales/zh-CN/main.json" with { type: "json" };

// Bundled resources make every lookup synchronous; per-call language
// overrides keep the pure builders (tray menu, status) free of global state.
// English is the fallback a missed key degrades to. Values go into native
// menus and dialogs, so interpolation does not HTML-escape them.
void i18next.init({
  resources: { en: { main: enMain }, "zh-CN": { main: zhCNMain } },
  lng: "en",
  fallbackLng: "en",
  defaultNS: "main",
  interpolation: { escapeValue: false },
});

/**
 * One main-process string in one language. Values fill `{{placeholders}}`;
 * `count` picks the plural form.
 */
export function translate(
  language: UiLanguage | undefined,
  key: string,
  values?: Record<string, unknown>,
): string {
  return i18next.t(key, {
    lng: language ?? "en",
    ns: "main",
    ...(values ?? {}),
  });
}
