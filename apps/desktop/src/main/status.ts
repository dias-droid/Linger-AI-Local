import type { RuntimeState, UiLanguage } from "../shared/api.js";
import { translate } from "../i18n/i18n.js";
import type { ComputerDaemonModule } from "./computer-daemon.js";
import type { LanguageModule } from "./language.js";
import type { Module, ModuleContext } from "./modules.js";

export type StatusTone = "online" | "busy" | "offline" | "error" | "setup";

export interface StatusInput {
  // ComputerDaemonModule.connection().
  readonly connection: string;
  readonly runtime: RuntimeState;
  readonly enrolled: boolean;
  readonly running: number;
  // Absent reads as English, so existing callers and tests are unchanged.
  readonly language?: UiLanguage;
}

export interface StatusSummary {
  readonly tone: StatusTone;
  readonly label: string;
}

// One line shown at the top of the tray menu.
export const summarizeStatus = (input: StatusInput): StatusSummary => {
  const language = input.language;
  if (!input.enrolled)
    return { tone: "setup", label: translate(language, "status.notConnected") };
  switch (input.connection) {
    case "auth_failed":
      return {
        tone: "error",
        label: translate(language, "status.signInExpired"),
      };
    case "identity_conflict":
      return {
        tone: "error",
        label: translate(language, "status.identityConflict"),
      };
    case "upgrade_required":
      return {
        tone: "error",
        label: translate(language, "status.updateRequired"),
      };
  }
  if (input.runtime === "crashed")
    return { tone: "error", label: translate(language, "status.runtimeError") };
  if (input.runtime !== "ready")
    return { tone: "offline", label: translate(language, "status.starting") };
  if (input.connection !== "online")
    return {
      tone: "offline",
      label: translate(language, "status.offlineReconnecting"),
    };
  if (input.running > 0)
    return {
      tone: "busy",
      label: translate(language, "status.tasks", { count: input.running }),
    };
  return { tone: "online", label: translate(language, "status.onlineIdle") };
};

// Recomputes the summary from module state and announces changes.
export class StatusModule implements Module {
  readonly name = "Status";
  readonly dependsOn = ["ComputerDaemon", "Language"];
  #ctx: ModuleContext | undefined;
  #current: StatusSummary = { tone: "offline", label: "Starting…" };
  readonly #unsubscribe: (() => void)[] = [];

  async start(ctx: ModuleContext): Promise<void> {
    this.#ctx = ctx;
    const update = (): void => this.#update();
    this.#unsubscribe.push(
      ctx.bus.on("computer.connection", update),
      ctx.bus.on("runtime.state", update),
      ctx.bus.on("runtime.activity", update),
      ctx.bus.on("computer.changed", update),
      // The summary line and the tray rebuild in the chosen language.
      ctx.bus.on("language.changed", update),
    );
    this.#update();
  }

  async stop(): Promise<void> {
    for (const off of this.#unsubscribe.splice(0)) off();
  }

  current(): StatusSummary {
    return this.#current;
  }

  #update(): void {
    const ctx = this.#ctx!;
    const daemon = ctx.get<ComputerDaemonModule>("ComputerDaemon");
    const next = summarizeStatus({
      connection: daemon.connection(),
      runtime: daemon.state(),
      enrolled: !!ctx.config.get().computerId,
      running: daemon.running(),
      language: ctx.get<LanguageModule>("Language").current(),
    });
    if (next.tone === this.#current.tone && next.label === this.#current.label)
      return;
    this.#current = next;
    ctx.bus.emit("status.changed", next);
  }
}
