// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { shellDictionary } from "../main/i18n/shell-html.js";
import type {
  SetupCommand,
  SetupLocalAccount,
  SetupState,
} from "../shared/setup.js";

const page = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "setup.html"),
  "utf8",
);

// The same t() the injected bootstrap defines, so the page script runs
// exactly as a Simplified Chinese install would.
const t = (key: string, fallback: string) => shellDictionary[key] ?? fallback;

const state = (
  phase: SetupState["localServer"]["phase"],
  account?: SetupLocalAccount,
): SetupState => ({
  platform: "linux",
  version: "1.0.0",
  serverUrl: "http://localhost:3000",
  signedIn: phase === "ready",
  enrolled: phase === "ready",
  displayName: "Desk",
  preventSleep: false,
  openAtLogin: false,
  folders: [],
  localServer: {
    available: true,
    phase,
    message: "",
    steps: ["prepare", "services", "connect", "agents"],
    step: phase === "ready" ? "agents" : "services",
    progress: phase === "ready" ? 1 : 0.5,
    attempt: 1,
    localModels: { state: "unavailable" },
    location: { path: "~/.simplexai", custom: false },
    keys: { composio: false },
    ...(account ? { account } : {}),
  },
});

let stopPage = () => {};

const openPage = async (
  initial: SetupState = state("ready"),
  step = "ready",
) => {
  stopPage();
  const intervals: ReturnType<typeof setInterval>[] = [];
  const timeouts: ReturnType<typeof setTimeout>[] = [];
  stopPage = () => {
    intervals.forEach(clearInterval);
    timeouts.forEach(clearTimeout);
  };
  const [, body] = /<body[^>]*>([\s\S]*)<\/body>/.exec(page)!;
  const [, script] = /<script>([\s\S]*)<\/script>/.exec(body!)!;
  document.body.innerHTML = body!.replace(/<script>[\s\S]*<\/script>/, "");
  // What the injected bootstrap does before the page script runs.
  (window as { LINGER_I18N?: unknown }).LINGER_I18N = { lang: "zh-CN", t };
  document.documentElement.lang = "zh-CN";
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]"))
    el.textContent = t(el.dataset.i18n!, el.textContent ?? "");
  let listener: ((next: SetupState) => void) | undefined;
  let current = initial;
  const run = vi.fn(async (command: SetupCommand) => {
    if (command.op === "local.account.show")
      current = state("ready", {
        email: "owner@linger.local",
        ...(command.on ? { password: "a-private-password" } : {}),
      });
    return current;
  });
  Object.assign(window, {
    matchMedia: () => ({ matches: true }),
    lingerSetup: {
      getState: async () => current,
      onState: (callback: (next: SetupState) => void) => {
        listener = callback;
        return () => {};
      },
      run,
    },
  });
  new Function("setInterval", "setTimeout", script!)(
    (...args: Parameters<typeof setInterval>) => {
      const id = setInterval(...args);
      intervals.push(id);
      return id;
    },
    (...args: Parameters<typeof setTimeout>) => {
      const id = setTimeout(...args);
      timeouts.push(id);
      return id;
    },
  );
  await vi.waitFor(() =>
    expect(
      document.querySelector(`section[data-step="${step}"].active`),
    ).not.toBeNull(),
  );
  return {
    push: (next: SetupState) => {
      current = next;
      listener!(next);
    },
  };
};

const $ = (id: string) => document.getElementById(id)!;

beforeEach(() => {
  document.body.innerHTML = "";
  delete (window as { LINGER_I18N?: unknown }).LINGER_I18N;
  // A failure scrolls its actions into view, which jsdom lacks.
  Element.prototype.scrollIntoView = () => {};
});

describe("setup page in Simplified Chinese", () => {
  it("translates the static page and the ready screen", async () => {
    // Mid-install first, then ready, like the English page test: a ready
    // first state opens the permissions step instead.
    const { push } = await openPage(state("installing"), "installing");
    push(state("ready", { email: "owner@linger.local" }));
    expect(
      document.querySelector<HTMLElement>('[data-step="ready"] h1')!
        .textContent,
    ).toBe("Linger \u5df2\u5c31\u7eea");
    expect($("ready-lead").textContent).toBe(
      "\u4ec5\u5728\u8fd9\u53f0\u8ba1\u7b97\u673a\u4e0a\u4e3a\u4f60\u8fd0\u884c。",
    );
    expect($("open").textContent?.trim()).toBe("\u6253\u5f00 Linger");
    expect($("account-email").textContent).toBe("owner@linger.local");
    expect($("account-show").textContent).toBe("\u663e\u793a");
    expect($("account-copy").textContent).toBe("\u590d\u5236");
    expect($("account-reveal").textContent?.trim()).toBe(
      "\u6253\u5f00\u8d26\u6237\u6587\u4ef6\u4f4d\u7f6e",
    );
    expect(
      document.querySelector<HTMLElement>("#account-note")!.textContent,
    ).toContain("\u9000\u51fa\u767b\u5f55\u540e");
    push(state("ready", { email: "owner@linger.local" }));
    expect($("account-show").textContent).toBe("\u663e\u793a");
  });

  it("translates the welcome screen and the plan wording", async () => {
    await openPage(
      {
        ...state("idle"),
        localServer: {
          ...state("idle").localServer,
          localModels: {
            state: "checked",
            eligible: false,
            memoryBytes: 8 * 1024 ** 3,
            diskFreeBytes: 100 * 1024 ** 3,
            reasons: [{ code: "plan-unavailable" }],
            recommendation: "codex",
          },
        },
      },
      "welcome",
    );
    expect(
      document.querySelector<HTMLElement>('[data-step="welcome"] h1')!
        .textContent,
    ).toBe("\u8bbe\u7f6e Linger");
    expect($("plan-summary").textContent).toBe(
      "\u8fd9\u53f0\u8ba1\u7b97\u673a\u7684\u63a8\u8350\u914d\u7f6e：Codex",
    );
    expect($("plan-why").textContent).toBe(
      "\u6ca1\u6709\u9002\u5408\u8fd9\u53f0\u8ba1\u7b97\u673a\u7684\u672c\u5730\u6a21\u578b。",
    );
    expect($("local-install-label").textContent).toBe(
      "\u5feb\u901f\u5b89\u88c5",
    );
    expect($("local-customize").textContent).toBe("\u81ea\u5b9a\u4e49");
    expect(document.querySelector<HTMLElement>("#team")!.textContent).toContain(
      "\u6539\u4e3a\u8fde\u63a5\u56e2\u961f\u670d\u52a1\u5668",
    );
  });

  it("translates the server, sign-in and connect steps", async () => {
    await openPage(state("idle"), "welcome");
    // The step pages translate from their static markup alone.
    expect(
      document.querySelector<HTMLElement>('[data-step="server"] h1')!
        .textContent,
    ).toBe("\u56e2\u961f\u7684 Linger \u5728\u54ea\u91cc？");
    expect(
      document.querySelector<HTMLElement>('[data-step="signin"] h1')!
        .textContent,
    ).toBe("\u767b\u5f55\u4f60\u7684\u8d26\u6237");
    expect(
      document.querySelector<HTMLElement>('[data-step="connect"] h1')!
        .textContent,
    ).toBe("\u8fde\u63a5\u8fd9\u53f0\u8ba1\u7b97\u673a");
    expect(
      document.querySelector<HTMLElement>('[data-step="permissions"] h1')!
        .textContent,
    ).toBe("\u51e0\u9879\u6743\u9650");
    expect(
      document.querySelector<HTMLElement>("#finish")!.textContent?.trim(),
    ).toBe("\u5f00\u59cb\u4f7f\u7528 Linger");
  });

  it("translates the installing screen and its step names", async () => {
    const { push } = await openPage(state("installing"), "installing");
    expect($("installing-title").textContent).toBe(
      "\u6b63\u5728\u5b89\u88c5 Linger",
    );
    expect($("installing-plan").textContent).toBe(
      "\u5927\u7ea6\u9700\u8981\u51e0\u5206\u949f。\u4f60\u53ef\u4ee5\u7ee7\u7eed\u5de5\u4f5c。",
    );
    expect($("installing-step").textContent).toBe(
      "\u6b63\u5728\u8bbe\u7f6e AI \u4e0e\u672c\u5730\u670d\u52a1…",
    );
    expect($("installing-count").textContent).toBe("50%");
    const checks = [...$("installing-checks").children].map(
      (item) => item.children[1]!.textContent,
    );
    expect(checks).toEqual([
      "\u6b63\u5728\u68c0\u67e5\u8fd9\u53f0\u8ba1\u7b97\u673a",
      "\u6b63\u5728\u8bbe\u7f6e AI \u4e0e\u672c\u5730\u670d\u52a1",
      "\u6b63\u5728\u8fde\u63a5\u8fd9\u53f0\u8ba1\u7b97\u673a",
      "\u6b63\u5728\u51c6\u5907\u4f60\u7684\u667a\u80fd\u4f53",
    ]);
    push({
      ...state("installing"),
      localServer: {
        ...state("installing").localServer,
        phase: "failed",
        message: "Services did not start",
      },
    });
    expect($("installing-title").textContent).toBe(
      "\u5b89\u88c5\u5df2\u505c\u6b62",
    );
    expect($("installing-plan").textContent).toBe(
      "\u4f60\u7684\u6570\u636e\u5df2\u4fdd\u7559。\u89e3\u51b3\u95ee\u9898\u540e\u91cd\u8bd5。",
    );
    expect($("local-retry").textContent?.trim()).toBe("\u91cd\u8bd5");
  });
});
