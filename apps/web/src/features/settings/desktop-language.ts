import type { LanguageChoice, UiLanguage } from "@/i18n/languages";

// The desktop shell's tray, setup window and dialogs follow the language
// chosen here (`window.lingerDesktop.settings`, exposed by the Electron
// preload; see apps/desktop/src/shared/api.ts). In a browser it is absent and
// the choice stays a web preference.
interface DesktopSettingsApi {
  set(patch: { language?: UiLanguage | null }): Promise<unknown>;
}

/**
 * Tells the desktop shell about a language choice. Fire-and-forget: the web
 * language applies regardless, and a missing or failing bridge changes
 * nothing visible here.
 */
export function syncDesktopLanguage(choice: LanguageChoice) {
  const api = (
    window as {
      lingerDesktop?: { settings?: DesktopSettingsApi };
    }
  ).lingerDesktop?.settings;
  if (!api) return;
  void api.set({ language: choice === "system" ? null : choice }).catch(
    // The desktop shell keeps its previous language.
    () => undefined,
  );
}
