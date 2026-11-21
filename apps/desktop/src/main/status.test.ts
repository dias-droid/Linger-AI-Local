import { describe, expect, it } from "vitest";

import { summarizeStatus } from "./status.js";

const base = {
  connection: "online",
  runtime: "ready" as const,
  enrolled: true,
  running: 0,
};

describe("summarizeStatus", () => {
  it("describes each state in one line", () => {
    expect(summarizeStatus(base)).toEqual({
      tone: "online",
      label: "Online · Idle",
    });
    expect(summarizeStatus({ ...base, running: 2 })).toEqual({
      tone: "busy",
      label: "Running 2 Tasks",
    });
    expect(summarizeStatus({ ...base, connection: "connecting" })).toEqual({
      tone: "offline",
      label: "Offline · Reconnecting",
    });
    expect(summarizeStatus({ ...base, connection: "auth_failed" }).tone).toBe(
      "error",
    );
    expect(summarizeStatus({ ...base, runtime: "crashed" }).tone).toBe("error");
    expect(summarizeStatus({ ...base, runtime: "starting" }).label).toBe(
      "Starting…",
    );
    expect(summarizeStatus({ ...base, enrolled: false }).tone).toBe("setup");
  });

  it("asks to reconnect when the daemon has no valid credential", () => {
    expect(
      summarizeStatus({
        ...base,
        connection: "auth_failed",
        runtime: "stopped",
      }),
    ).toEqual({
      tone: "error",
      label: "Sign-in Expired · Reconnect This Computer",
    });
  });

  it("asks to reconnect on a Daemon Identity conflict", () => {
    expect(
      summarizeStatus({
        ...base,
        connection: "identity_conflict",
      }),
    ).toEqual({
      tone: "error",
      label: "Computer Identity Conflict · Reconnect This Computer",
    });
  });
});

describe("summarizeStatus in Simplified Chinese", () => {
  it("translates each state line", () => {
    expect(summarizeStatus({ ...base, language: "zh-CN" })).toEqual({
      tone: "online",
      label: "\u5728\u7ebf · \u7a7a\u95f2",
    });
    expect(summarizeStatus({ ...base, running: 3, language: "zh-CN" })).toEqual(
      { tone: "busy", label: "\u6b63\u5728\u8fd0\u884c 3 \u4e2a\u4efb\u52a1" },
    );
    expect(
      summarizeStatus({ ...base, connection: "connecting", language: "zh-CN" }),
    ).toEqual({
      tone: "offline",
      label: "\u79bb\u7ebf · \u6b63\u5728\u91cd\u65b0\u8fde\u63a5",
    });
    expect(
      summarizeStatus({ ...base, runtime: "starting", language: "zh-CN" })
        .label,
    ).toBe("\u6b63\u5728\u542f\u52a8…");
    expect(
      summarizeStatus({ ...base, enrolled: false, language: "zh-CN" }).label,
    ).toBe("\u672a\u8fde\u63a5");
  });
});
