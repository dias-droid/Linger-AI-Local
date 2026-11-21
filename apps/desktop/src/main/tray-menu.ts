import type { UiLanguage } from "../shared/api.js";
import { translate } from "../i18n/i18n.js";
import type { StatusSummary } from "./status.js";
import type { AnnouncedUpdate, UpdateState } from "./updater.js";

export type TrayAction =
  | "enroll"
  | "open"
  | "toggle-prevent-sleep"
  | "install-update"
  | "check-update"
  | "show-logs"
  | "save-diagnostics"
  | "send-diagnostics"
  | "quit";

export type TrayMenuItem =
  | { readonly kind: "label"; readonly label: string }
  | { readonly kind: "separator" }
  | {
      readonly kind: "action";
      readonly action: TrayAction;
      readonly label: string;
      readonly checked?: boolean;
    };

export interface TrayMenuState {
  readonly status: StatusSummary;
  readonly preventSleep: boolean;
  readonly enrolled: boolean;
  // The updater's progress; a failure says why, since it is otherwise only
  // in the log.
  readonly update?: UpdateState;
  // A diagnostics server is set up, so reports can be sent from here.
  readonly canSendDiagnostics?: boolean;
  // Absent reads as English, so existing callers and tests are unchanged.
  readonly language?: UiLanguage;
}

// The tray menu. Items for features that do not exist yet
// (pause, approvals) are added with those features.
export const trayMenu = (state: TrayMenuState): TrayMenuItem[] => [
  { kind: "label", label: state.status.label },
  ...updateItems(state.update, state.language),
  { kind: "separator" },
  {
    kind: "action",
    action: "open",
    label: translate(state.language, "tray.open"),
  },
  // Reconnecting re-enrolls the same computer, e.g. after its credential
  // was rejected or the server moved.
  {
    kind: "action",
    action: "enroll",
    label: state.enrolled
      ? translate(state.language, "tray.reconnect")
      : translate(state.language, "tray.connect"),
  },
  {
    kind: "action",
    action: "toggle-prevent-sleep",
    label: translate(state.language, "tray.preventSleep"),
    checked: state.preventSleep,
  },
  { kind: "separator" },
  // What to send when something goes wrong.
  {
    kind: "action",
    action: "show-logs",
    label: translate(state.language, "tray.showLogs"),
  },
  {
    kind: "action",
    action: "save-diagnostics",
    label: translate(state.language, "tray.saveDiagnostics"),
  },
  ...(state.canSendDiagnostics
    ? [
        {
          kind: "action" as const,
          action: "send-diagnostics" as const,
          label: translate(state.language, "tray.sendDiagnostics"),
        },
      ]
    : []),
  { kind: "separator" },
  // Tasks run in the app, so quitting takes the computer offline.
  {
    kind: "action",
    action: "quit",
    label: translate(state.language, "tray.quit"),
  },
];

// Long native errors would stretch the menu; the log has the full text.
const REASON_LENGTH = 80;

const updateItems = (
  update: TrayMenuState["update"],
  language: UiLanguage | undefined,
): TrayMenuItem[] => {
  switch (update?.kind) {
    case "downloading":
      return [
        {
          kind: "label",
          label: translate(language, "update.downloading", {
            version: update.version,
          }),
        },
      ];
    case "ready":
      return [
        {
          kind: "action",
          action: "install-update",
          label: translate(language, "update.restartToUpdate", {
            version: update.version,
          }),
        },
      ];
    case "waiting":
      return [
        {
          kind: "label",
          label: translate(language, "update.waiting", {
            version: update.version,
          }),
        },
      ];
    case "available":
      return [
        {
          kind: "action",
          action: "install-update",
          label: translate(language, "update.download", {
            version: update.version,
          }),
        },
      ];
    case "failed": {
      const reason =
        update.error.length > REASON_LENGTH
          ? `${update.error.slice(0, REASON_LENGTH - 1)}…`
          : update.error;
      return [
        {
          kind: "label",
          label: translate(language, "update.failed", { reason }),
        },
        {
          kind: "action",
          action: "check-update",
          label: translate(language, "update.tryAgain"),
        },
      ];
    }
    default:
      return [];
  }
};

// The notification for an update once it is ready or available; clicking it
// does what the tray's update item does.
export function updateNotice(
  update: AnnouncedUpdate,
  language: UiLanguage = "en",
): { title: string; body: string } {
  if (update.kind === "available")
    return {
      title: translate(language, "update.noticeAvailableTitle"),
      body: translate(language, "update.noticeAvailableBody", {
        version: update.version,
      }),
    };
  return {
    title: translate(language, "update.noticeReadyTitle"),
    body: translate(language, "update.noticeReadyBody", {
      version: update.version,
    }),
  };
}
