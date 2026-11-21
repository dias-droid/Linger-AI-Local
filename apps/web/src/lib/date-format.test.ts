import { afterEach, describe, expect, it } from "vitest";
import { initUiLanguage } from "@/i18n/i18n";
import {
  dateTimeFormat,
  dayKey,
  formatDateTime,
  formatUpdatedAt,
} from "./date-format";

// Switching the shared i18next language must not reach later files.
afterEach(() => {
  initUiLanguage("en");
});

describe("date-format", () => {
  it("keys days at local midnight", () => {
    expect(dayKey(new Date(2026, 9, 20, 23, 59, 59))).toBe("2026-10-20");
    expect(dayKey(new Date(2026, 9, 21))).toBe("2026-10-21");
  });

  it("formats string input with the default medium date and short time", () => {
    expect(
      formatDateTime("2026-10-21T08:05:00Z", {
        dateStyle: "medium",
        timeZone: "UTC",
      }),
    ).toBe("Oct 21, 2026");
    expect(formatDateTime("2026-10-21T08:05:00Z")).toMatch(/Oct 21, 2026/);
  });

  it("resolves to the app locale", () => {
    expect(dateTimeFormat().resolvedOptions().locale).toBe("en-US");
  });

  it("says when something changed: relative within a week, then a date", () => {
    const now = new Date(2026, 10, 7, 12).getTime();
    expect(formatUpdatedAt(now - 30_000, now)).toBe("just now");
    expect(formatUpdatedAt(now - 2 * 3_600_000, now)).toBe("2 hours ago");
    expect(formatUpdatedAt(now - 86_400_000, now)).toBe("yesterday");
    expect(formatUpdatedAt(new Date(2026, 9, 21, 9), now)).toBe("Oct 21");
    expect(formatUpdatedAt(new Date(2025, 9, 21, 9), now)).toBe("Oct 21, 2025");
    expect(formatUpdatedAt("not a date", now)).toBe("—");
  });

  it("keeps day keys stable across languages", () => {
    const value = new Date(2026, 9, 20, 23, 59, 59);
    expect(dayKey(value)).toBe("2026-10-20");
    initUiLanguage("zh-CN");
    expect(dayKey(value)).toBe("2026-10-20");
  });

  it("formats in Simplified Chinese when the interface language is zh-CN", () => {
    initUiLanguage("zh-CN");
    // The zh words stay as escaped code points; the repository is
    // English-only outside the localization catalogs (see AGENTS.md).
    expect(dateTimeFormat().resolvedOptions().locale).toBe("zh-CN");
    expect(
      formatDateTime("2026-10-21T08:05:00Z", {
        dateStyle: "medium",
        timeZone: "UTC",
      }),
    ).toBe("2026\u5e7410\u670821\u65e5");
    const now = new Date(2026, 10, 7, 12).getTime();
    expect(formatUpdatedAt(now - 30_000, now)).toBe("\u521a\u521a");
    // Node's ICU and browser CLDR disagree on the digit space in "2 hours ago".
    expect(formatUpdatedAt(now - 2 * 3_600_000, now)).toMatch(
      /^2 ?\u5c0f\u65f6\u524d$/,
    );
    expect(formatUpdatedAt(now - 86_400_000, now)).toBe("\u6628\u5929");
    expect(formatUpdatedAt(new Date(2026, 9, 21, 9), now)).toBe(
      "10\u670821\u65e5",
    );
    expect(formatUpdatedAt(new Date(2025, 9, 21, 9), now)).toBe(
      "2025\u5e7410\u670821\u65e5",
    );
  });
});
