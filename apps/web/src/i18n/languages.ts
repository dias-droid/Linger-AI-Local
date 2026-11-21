import { prefersSimplifiedChinese } from "@/app/han-font";

import languageNames from "./locales/language-names.json";

/** Languages the interface ships translations for. */
export const uiLanguages = ["en", "zh-CN"] as const;

export type UiLanguage = (typeof uiLanguages)[number];

/** A saved setting: a language, or "system" to follow the device language. */
export type LanguageChoice = UiLanguage | "system";

export const uiLanguageStorageKey = "linger.ui-language";

/** Language names shown in their own language, whatever the interface uses. */
export const uiLanguageNames: Record<UiLanguage, string> = languageNames;

/**
 * Reads the saved choice. A value from an older build or a tampered store
 * falls back to "system", so an unknown value never pins a language.
 */
export function readStoredLanguageChoice(): LanguageChoice {
  try {
    const stored = localStorage.getItem(uiLanguageStorageKey);
    if (stored === "en" || stored === "zh-CN" || stored === "system") {
      return stored;
    }
  } catch {
    // Choosing still works for this session without saved preferences.
  }
  return "system";
}

export function storeLanguageChoice(choice: LanguageChoice) {
  try {
    if (choice === "system") localStorage.removeItem(uiLanguageStorageKey);
    else localStorage.setItem(uiLanguageStorageKey, choice);
  } catch {
    // The choice still applies for this session without saved preferences.
  }
}

/** Resolves a choice to a language; "system" follows the device languages. */
export function resolveLanguageFromChoice(
  choice: LanguageChoice,
  languages: readonly string[],
): UiLanguage {
  if (choice !== "system") return choice;
  return prefersSimplifiedChinese(languages) ? "zh-CN" : "en";
}

/**
 * The language to start in: the saved choice when there is one, otherwise the
 * device's, otherwise English.
 */
export function resolveInitialLanguage(
  languages: readonly string[],
): UiLanguage {
  return resolveLanguageFromChoice(readStoredLanguageChoice(), languages);
}
