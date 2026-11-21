import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import { loadHanFont } from "@/app/han-font";

import enApps from "./locales/en/apps.json";
import enAuth from "./locales/en/auth.json";
import enCommon from "./locales/en/common.json";
import enLibrary from "./locales/en/library.json";
import enRooms from "./locales/en/rooms.json";
import enSettings from "./locales/en/settings.json";
import enWiki from "./locales/en/wiki.json";
import zhCNApps from "./locales/zh-CN/apps.json";
import zhCNAuth from "./locales/zh-CN/auth.json";
import zhCNCommon from "./locales/zh-CN/common.json";
import zhCNLibrary from "./locales/zh-CN/library.json";
import zhCNRooms from "./locales/zh-CN/rooms.json";
import zhCNSettings from "./locales/zh-CN/settings.json";
import zhCNWiki from "./locales/zh-CN/wiki.json";
import type { LanguageChoice, UiLanguage } from "./languages";
import { resolveLanguageFromChoice, storeLanguageChoice } from "./languages";

export const i18nResources = {
  en: {
    settings: enSettings,
    common: enCommon,
    auth: enAuth,
    apps: enApps,
    library: enLibrary,
    wiki: enWiki,
    rooms: enRooms,
  },
  "zh-CN": {
    settings: zhCNSettings,
    common: zhCNCommon,
    auth: zhCNAuth,
    apps: zhCNApps,
    library: zhCNLibrary,
    wiki: zhCNWiki,
    rooms: zhCNRooms,
  },
} as const;

// Bundled resources make init synchronous, so every import (test files
// included) sees a working i18next without waiting. English starts so readers
// without a saved choice see the strings the code review reads.
void i18next.use(initReactI18next).init({
  resources: i18nResources,
  lng: "en",
  fallbackLng: "en",
  defaultNS: "settings",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export { i18next };

/**
 * Applies a language now. Bundled resources resolve synchronously, so the
 * next render already translates.
 */
export function initUiLanguage(language: UiLanguage) {
  void i18next.changeLanguage(language);
  applyLanguageDomEffects(language);
}

/** Saves a choice and applies the language it resolves to. */
export function applyLanguageChoice(
  choice: LanguageChoice,
  languages: readonly string[],
) {
  storeLanguageChoice(choice);
  initUiLanguage(resolveLanguageFromChoice(choice, languages));
}

function applyLanguageDomEffects(language: UiLanguage) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  loadHanFont([language]);
}
