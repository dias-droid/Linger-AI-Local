import type { UiLanguage } from "../shared/api.js";
import type { Module, ModuleContext } from "./modules.js";

/** The interface language of an operating-system locale tag. A zh tag of any
 * region or script resolves to Simplified Chinese, the only Chinese the app
 * ships; everything else stays English. */
export function localeToUiLanguage(appLocale: string): UiLanguage {
  return /^zh/i.test(appLocale) ? "zh-CN" : "en";
}

/** The stored choice wins; without one the device language does. */
export function resolveLanguage(
  stored: UiLanguage | undefined,
  deviceLocale: string,
): UiLanguage {
  return stored ?? localeToUiLanguage(deviceLocale);
}

/** Holds the resolved interface language and announces changes to it. The
 * shell surfaces (tray, status, setup window, offline page) rebuild from the
 * "language.changed" event. */
export class LanguageModule implements Module {
  readonly name = "Language";
  readonly dependsOn: readonly string[] = [];
  readonly #deviceLocale: () => string;
  #ctx: ModuleContext | undefined;
  #current: UiLanguage = "en";

  constructor(options: { deviceLocale: () => string }) {
    this.#deviceLocale = options.deviceLocale;
  }

  async start(ctx: ModuleContext): Promise<void> {
    this.#ctx = ctx;
    this.#current = resolveLanguage(
      ctx.config.get().language,
      this.#deviceLocale(),
    );
  }

  async stop(): Promise<void> {}

  current(): UiLanguage {
    return this.#current;
  }

  /** Applies a choice from the web Settings and remembers it; null follows
   * the device language again. */
  set(choice: UiLanguage | null): UiLanguage {
    const ctx = this.#ctx!;
    // An absent key is dropped from the config file, so null clears the
    // stored override.
    ctx.config.update({ language: choice ?? undefined });
    this.#current = choice ?? localeToUiLanguage(this.#deviceLocale());
    ctx.bus.emit("language.changed", this.#current);
    return this.#current;
  }
}
