// @vitest-environment jsdom
import { expect, it } from "vitest";
import { loginCommands, signInCommand } from "./local-runtime-commands";

it.each([
  ["codex", "0.59.0"],
  ["claude", "0.60.1"],
  ["pi", "0.59.0+build.3"],
  ["antigravity", "1.0.0"],
] as const)(
  "signs in to %s through the Computer CLI on Windows %s",
  (runtimeType, version) => {
    expect(
      signInCommand(
        runtimeType,
        { computer_id: "c1", platform: "win32", daemon_version: version },
        "desktop",
      ),
    ).toBe(`linger-computer-local-3000 runtime login ${runtimeType}`);
  },
);

it.each([
  ["codex", { platform: "win32", daemon_version: "0.58.0" }],
  ["claude", { platform: "win32", daemon_version: "0.59.0-rc.1" }],
  ["pi", { platform: "win32" }],
  ["antigravity", { platform: "win32", daemon_version: "dev" }],
  ["codex", { platform: "darwin", daemon_version: "0.59.0" }],
  ["claude", { platform: "linux", daemon_version: "0.59.0" }],
  ["pi", { daemon_version: "0.59.0" }],
  [
    "antigravity",
    { computer_id: "desktop", platform: "win32", daemon_version: "0.59.0" },
  ],
] as const)("keeps the native %s command for %o", (runtimeType, computer) => {
  expect(signInCommand(runtimeType, computer, "desktop")).toBe(
    loginCommands[runtimeType],
  );
});

it("keeps the native command without a Computer", () => {
  expect(signInCommand("codex", undefined)).toBe("codex login");
});
