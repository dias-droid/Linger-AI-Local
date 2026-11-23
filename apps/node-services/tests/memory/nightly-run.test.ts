import { describe, expect, it } from "vitest";

import { isNightlyRun } from "../../src/memory/main.js";

describe("isNightlyRun", () => {
  it("recognizes only the configured closing hour", () => {
    expect(isNightlyRun("hourly", "2026-09-28T22", 22)).toBe(true);
    expect(isNightlyRun("hourly", "2026-09-28T00", 22)).toBe(false);
    expect(isNightlyRun("hourly", "2026-09-28T00", undefined)).toBe(true);
    expect(isNightlyRun("hourly", "2026-09-28T22", undefined)).toBe(false);
    expect(isNightlyRun("daily", "2026-09-28T22", 22)).toBe(false);
  });
});
