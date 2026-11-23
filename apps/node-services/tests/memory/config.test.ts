import path from "node:path";
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
        dailyHour: 0,
        timeZone: "Europe/Berlin",
        weeklyDay: 1,
      },
    });
  });

  it.each([
    ["0", 0],
    ["07", 7],
    ["23", 23],
  ])("reads daily consolidation hour %s", (value, expected) => {
    expect(
      readMemoryConfig({ LINGER_SECRET_SEED: seed, MEMORY_DAILY_HOUR: value })
        .schedule.dailyHour,
    ).toBe(expected);
  });

  it.each(["-1", "24", "2.5", "1e1", "0x10", "23:00"])(
    "rejects invalid daily consolidation hour %s",
    (value) => {
      expect(() =>
        readMemoryConfig({
          LINGER_SECRET_SEED: seed,
          MEMORY_DAILY_HOUR: value,
        }),
      ).toThrow("MEMORY_DAILY_HOUR must be an integer from 0 to 23");
    },
  );

  it("writes into the Agent's Context Host root under AGENT_HOME", () => {
    const agentHome = path.resolve("/srv/mirror");
    expect(
      readMemoryConfig({
        LINGER_SECRET_SEED: seed,
        AGENT_HOME: agentHome,
      }).dataRoot,
    ).toBe(path.join(agentHome, "agent-manager", "workspaces", "context-host"));
  });
  it("requires the secret seed", () => {
    expect(() => readMemoryConfig({})).toThrow(
      "LINGER_SECRET_SEED is required",
    );
  });
});
