import type { TeamHubExternalApp } from "@/features/teamhub/teamhub-types";
import { type Translate, translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";

import { connectorMessages as m } from "./connectors.messages";

export interface AppGroup {
  apps: readonly string[];
  id: string;
  title: Message;
}

/**
 * The Connectors page sections, ordered by how central each kind of app is to
 * daily work. TeamHub apps listed in no group (Google Drive, Facebook) stay
 * connectable elsewhere but are not offered on this page, so an app TeamHub
 * adds later appears here only once it is added to a group. Group names avoid
 * product nouns such as Profile, Chats, Docs, Projects and Sources.
 */
/** The Connectors tab for web search, beside the Composio app groups. */
export const WEB_SEARCH_FILTER = { id: "web-search", label: "Web search" };

export const APP_GROUPS: readonly AppGroup[] = [
  {
    id: "mail-calendar",
    title: m.groupMailCalendar,
    apps: [
      "gmail",
      "outlook",
      "google_calendar",
      "outlook_calendar",
      "calendly",
    ],
  },
  { id: "meetings", title: m.groupMeetings, apps: ["granola", "google_meet"] },
  {
    id: "productivity",
    title: m.groupProductivity,
    apps: ["github", "notion", "linear"],
  },
  { id: "messaging", title: m.groupMessaging, apps: ["slack", "discord"] },
  {
    id: "design-creative",
    title: m.groupDesignCreative,
    apps: ["figma", "canva"],
  },
  {
    id: "multimodal",
    title: m.groupMultimodal,
    apps: ["higgsfield", "fal_ai"],
  },
];

/**
 * One-line card labels. TeamHub's longer descriptions stay in the manage
 * dialog, where their import limits and scope matter.
 */
const APP_SUMMARIES: Record<string, Message> = {
  calendly: m.summaryCalendly,
  canva: m.summaryCanva,
  discord: m.summaryDiscord,
  fal_ai: m.summaryFalAi,
  figma: m.summaryFigma,
  github: m.summaryGitHub,
  gmail: m.summaryMail,
  google_calendar: m.summaryCalendar,
  google_meet: m.summaryGoogleMeet,
  granola: m.summaryGranola,
  higgsfield: m.summaryHiggsfield,
  linear: m.summaryLinear,
  notion: m.summaryNotion,
  outlook: m.summaryMail,
  outlook_calendar: m.summaryCalendar,
  slack: m.summarySlack,
};

/** What the app holds, in a few words; TeamHub's description for other apps. */
export function appSummary(app: TeamHubExternalApp, t: Translate = translate) {
  const summary = APP_SUMMARIES[app.key];
  return summary ? t(summary) : app.description;
}

/** Each group with the catalog apps it holds, in group order; empty groups drop. */
export function groupCatalogApps(apps: readonly TeamHubExternalApp[]) {
  const byKey = new Map(apps.map((app) => [app.key, app]));
  return APP_GROUPS.map((group) => ({
    group,
    apps: group.apps.flatMap((key) => byKey.get(key) ?? []),
  })).filter((entry) => entry.apps.length > 0);
}
