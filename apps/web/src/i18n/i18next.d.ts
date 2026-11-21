// Types the translation keys so a missing or misspelled key fails the
// typecheck instead of silently rendering the key itself.
import type apps from "./locales/en/apps.json";
import type auth from "./locales/en/auth.json";
import type common from "./locales/en/common.json";
import type library from "./locales/en/library.json";
import type rooms from "./locales/en/rooms.json";
import type settings from "./locales/en/settings.json";
import type wiki from "./locales/en/wiki.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "settings";
    resources: {
      settings: typeof settings;
      common: typeof common;
      auth: typeof auth;
      apps: typeof apps;
      library: typeof library;
      wiki: typeof wiki;
      rooms: typeof rooms;
    };
  }
}
