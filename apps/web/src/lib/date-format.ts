import i18next from "i18next";

// Every interface language formats in its own locale; English keeps the app's
// original en-US output. Formatters cache per locale and reset when the
// interface language changes.
const localesByLanguage = {
  en: "en-US",
  "zh-CN": "zh-CN",
} as const;

type SupportedLanguage = keyof typeof localesByLanguage;

function currentLocale(): string {
  const language = i18next.language as SupportedLanguage | undefined;
  return (language && localesByLanguage[language]) || localesByLanguage.en;
}

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();
const relativeTimeFormats = new Map<string, Intl.RelativeTimeFormat>();

i18next.on("languageChanged", () => {
  dateTimeFormats.clear();
  relativeTimeFormats.clear();
});

export function dateTimeFormat(
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const cacheKey = `${currentLocale()}:${JSON.stringify(options ?? {})}`;
  let formatter = dateTimeFormats.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(currentLocale(), options);
    dateTimeFormats.set(cacheKey, formatter);
  }
  return formatter;
}

export function formatDateTime(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
): string {
  return dateTimeFormat(options).format(new Date(value));
}

/** `YYYY-MM-DD` of the instant in the browser's time zone. Memory, Pocket Notes
 * and the Wiki partition days in the server's local zone; on one machine the
 * two are the same. */
export function dayKey(value: Date): string {
  const parts = dateTimeFormat({
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function relativeTimeFormat(): Intl.RelativeTimeFormat {
  const formatter = relativeTimeFormats.get(currentLocale());
  if (formatter) return formatter;
  const created = new Intl.RelativeTimeFormat(currentLocale(), {
    numeric: "auto",
  });
  relativeTimeFormats.set(currentLocale(), created);
  return created;
}

/** The one way everything says "less than a minute ago". Callers that never
 * loaded the interface translations (unit tests, background rendering) keep
 * the English fallback. */
function justNowText(): string {
  if (!i18next.isInitialized) return "just now";
  return i18next.t("common:justNow");
}

const relativeUnits = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
] as const;
const RELATIVE_WINDOW_MS = 7 * 86_400_000;

/**
 * When something last changed, the one way lists and cards say it: "2 hours
 * ago" within a week, then "Nov 7", with the year only when it is not this one.
 */
export function formatUpdatedAt(
  value: Date | string | number,
  now = Date.now(),
): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "—";
  const elapsed = Math.max(0, now - time);
  if (elapsed < 60_000) return justNowText();
  if (elapsed < RELATIVE_WINDOW_MS) {
    const [unit, size] = relativeUnits.find(([, size]) => elapsed >= size)!;
    return relativeTimeFormat().format(-Math.floor(elapsed / size), unit);
  }
  const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();
  return dateTimeFormat({
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(time);
}
