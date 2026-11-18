import { afterEach, describe, expect, it, vi } from "vitest";

import { IPC } from "../shared/api.js";
import type { UpdateState } from "./updater.js";

const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
);
vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => unknown,
    ) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}));

const { DesktopIpcModule } = await import("./desktop-ipc.js");
const { EventBus } = await import("./modules.js");
const { stubModule, testHost } = await import("./test-support.js");

const SERVER = "http://localhost:3000";
const PASSWORD = "a-private-password";

const fixture = async (
  localServer: {
    servesWindow?: () => Promise<boolean>;
    signInWithAccount?: () => Promise<void>;
  } = {},
) => {
  const local = {
    ...stubModule("LocalServer"),
    servesWindow: vi.fn(localServer.servesWindow ?? (async () => true)),
    signInWithAccount: vi.fn(localServer.signInWithAccount ?? (async () => {})),
  };
  let updateState: UpdateState = { kind: "idle" };
  const updater = {
    ...stubModule("Updater"),
    state: () => updateState,
    install: vi.fn(async () => {}),
    check: vi.fn(async () => {}),
  };
  const send = vi.fn();
  const windows = {
    ...stubModule("WindowManager"),
    webContents: () => ({ send }),
  };
  const bus = new EventBus();
  const host = testHost(
    [
      stubModule("Enrollment"),
      stubModule("PowerGuard"),
      stubModule("ComputerDaemon"),
      windows as never,
      stubModule("WorkspaceGrants"),
      updater as never,
      local as never,
      new DesktopIpcModule({ defaultDisplayName: "Desk" }),
    ],
    { serverUrl: SERVER },
    bus,
  );
  await host.start();
  const invoke = (channel: string, origin = SERVER) =>
    handlers.get(channel)!({ senderFrame: { origin } });
  const setUpdate = (state: UpdateState) => {
    updateState = state;
    bus.emit("update.changed", state.kind);
  };
  return { host, local, updater, send, setUpdate, invoke };
};

afterEach(() => handlers.clear());

describe("DesktopIpcModule local account", () => {
  it("offers the account only for the installed server", async () => {
    const f = await fixture({ servesWindow: async () => false });
    expect(await f.invoke(IPC.localAccountAvailable)).toBe(false);
    f.local.servesWindow.mockResolvedValue(true);
    expect(await f.invoke(IPC.localAccountAvailable)).toBe(true);
    await f.host.stop("quit");
  });

  it("rejects pages from any other origin", async () => {
    const f = await fixture();
    expect(() =>
      f.invoke(IPC.localAccountSignIn, "https://evil.example.com"),
    ).toThrow("Not allowed");
    expect(() =>
      f.invoke(IPC.localAccountAvailable, "https://evil.example.com"),
    ).toThrow("Not allowed");
    expect(f.local.signInWithAccount).not.toHaveBeenCalled();
    await f.host.stop("quit");
  });

  it("signs in and returns no account data to the page", async () => {
    const f = await fixture();
    expect(await f.invoke(IPC.localAccountSignIn)).toEqual({ ok: true });
    expect(f.local.signInWithAccount).toHaveBeenCalledOnce();
    await f.host.stop("quit");
  });

  it("returns why signing in failed", async () => {
    const f = await fixture({
      signInWithAccount: async () => {
        throw new Error(
          "The local account file must be private and owned by the current user (chmod 600).",
        );
      },
    });
    const result = await f.invoke(IPC.localAccountSignIn);
    expect(result).toEqual({
      ok: false,
      message:
        "The local account file must be private and owned by the current user (chmod 600).",
    });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    await f.host.stop("quit");
  });
});

describe("DesktopIpcModule updates", () => {
  it("gives the page the update state without its release page URL", async () => {
    const f = await fixture();
    expect(await f.invoke(IPC.updateState)).toEqual({ kind: "idle" });
    f.setUpdate({
      kind: "available",
      version: "0.2.0",
      url: "https://github.com/example/linger/releases/tag/v0.2.0",
    });
    expect(await f.invoke(IPC.updateState)).toEqual({
      kind: "available",
      version: "0.2.0",
    });
    expect(f.send).toHaveBeenLastCalledWith(IPC.updateStateEvent, {
      kind: "available",
      version: "0.2.0",
    });
    await f.host.stop("quit");
  });

  it("pushes each change the tray shows", async () => {
    const f = await fixture();
    f.setUpdate({ kind: "downloading", version: "0.2.0" });
    f.setUpdate({ kind: "ready", version: "0.2.0" });
    f.setUpdate({ kind: "failed", error: "Update package does not match" });
    expect(f.send.mock.calls).toEqual([
      [IPC.updateStateEvent, { kind: "downloading", version: "0.2.0" }],
      [IPC.updateStateEvent, { kind: "ready", version: "0.2.0" }],
      [
        IPC.updateStateEvent,
        { kind: "failed", error: "Update package does not match" },
      ],
    ]);
    await f.host.stop("quit");
    f.setUpdate({ kind: "idle" });
    expect(f.send).toHaveBeenCalledTimes(3);
  });

  it("installs and checks through the updater the tray uses", async () => {
    const f = await fixture();
    await f.invoke(IPC.updateInstall);
    await f.invoke(IPC.updateCheck);
    expect(f.updater.install).toHaveBeenCalledOnce();
    expect(f.updater.check).toHaveBeenCalledOnce();
    await f.host.stop("quit");
  });

  it("rejects update calls from any other origin", async () => {
    const f = await fixture();
    for (const channel of [IPC.updateState, IPC.updateInstall, IPC.updateCheck])
      expect(() => f.invoke(channel, "https://evil.example.com")).toThrow(
        "Not allowed",
      );
    expect(f.updater.install).not.toHaveBeenCalled();
    expect(f.updater.check).not.toHaveBeenCalled();
    await f.host.stop("quit");
  });
});
