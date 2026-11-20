import type { TeamHubWebSearchKeyBackend } from "@/features/teamhub/teamhub-types";

import braveLogo from "./logos/brave.svg";
import firecrawlLogo from "./logos/firecrawl.svg";
import tavilyLogo from "./logos/tavily.svg";
import youLogo from "./logos/you.svg";

// Kept apart from the backend names so the chat's settled-card notices,
// which load with every Room, do not bundle the logos.
const logos: Record<TeamHubWebSearchKeyBackend, string> = {
  brave: braveLogo,
  firecrawl: firecrawlLogo,
  tavily: tavilyLogo,
  you: youLogo,
};

/** The bundled logo of a backend that takes a key; direct has none. */
export function webSearchBackendLogo(id: string): string | undefined {
  return logos[id as TeamHubWebSearchKeyBackend];
}
