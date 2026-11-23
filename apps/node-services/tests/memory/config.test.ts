import { afterEach, describe, expect, it, vi } from "vitest";

import { readMemoryConfig } from "../../src/memory/config.js";
import { contextHostRoot } from "../../src/paths.js";

const seed = "test-seed-0123456789abcdef0123456789";

describe("readMemoryConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("schedules in the process time zone", () => {
    vi.stubEnv("TZ", "Europe/Berlin");
    expect(readMemoryConfig({ LINGER_SECRET_SEED: seed })).toMatchObject({
      dataRoot: contextHostRoot({}),
      schedule: {
        timeZone: "Europe/Berlin",
        weeklyDay: 1,
      },
    });
  });
  it("writes into the Agent's Context Host root under AGENT_HOME", () => {
    expect(
      readMemoryConfig({
        LINGER_SECRET_SEED: seed,
        AGENT_HOME: "/srv/mirror",
      }).dataRoot,
    ).toBe("/srv/mirror/agent-manager/workspaces/context-host");
  });
  it("requires the secret seed", () => {
    expect(() => readMemoryConfig({})).toThrow(
      "LINGER_SECRET_SEED is required",
    );
  });
});

describe("the consolidation hour", () => {
  it("closes the day at midnight unless the variable sets another hour", () => {
    expect(
      readMemoryConfig({ LINGER_SECRET_SEED: seed }).schedule.dailyHour,
    ).toBe(0);
    expect(
      readMemoryConfig({
        LINGER_SECRET_SEED: seed,
        MEMORY_DAILY_HOUR: " 22 ",
      }).schedule.dailyHour,
    ).toBe(22);
    expect(
      readMemoryConfig({
        LINGER_SECRET_SEED: seed,
        MEMORY_DAILY_HOUR: "0",
      }).schedule.dailyHour,
    ).toBe(0);
  });

  it("refuses an hour that is not on a clock", () => {
    for (const value of ["24", "7.5", "-1", "evening"])
      expect(() =>
        readMemoryConfig({
          LINGER_SECRET_SEED: seed,
          MEMORY_DAILY_HOUR: value,
        }),
      ).toThrow(/MEMORY_DAILY_HOUR/);
  });
});
