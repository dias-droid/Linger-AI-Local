import {
  BYOK_PROTOCOL_ENDPOINTS,
  DEFAULT_BYOK_PATH,
} from "@linger/service-kit/byok-endpoint";
import type { components } from "@linger/wire-contracts/teamhub-public/types";

type Schemas = components["schemas"];
type ByokProtocol = Schemas["ByokProtocol"];

/** Paths some providers document; any other path can be typed. */
export const byokPathSuggestions: readonly { label: string; value: string }[] =
  [
    { label: "Most providers", value: DEFAULT_BYOK_PATH },
    {
      label: "Zhipu GLM (base https://open.bigmodel.cn)",
      value: "/api/paas/v4",
    },
    { label: "Volcano Engine Ark", value: "/api/v3" },
    { label: "Gemini", value: "/v1beta/openai" },
    { label: "No path. The base URL already has it.", value: "" },
  ];

/** The three endpoints whose ending names a wire format, then none. */
export const byokEndpointSuggestions: readonly {
  protocol?: ByokProtocol;
  value: string;
}[] = [
  { protocol: "openai-chat", value: BYOK_PROTOCOL_ENDPOINTS["openai-chat"] },
  {
    protocol: "openai-responses",
    value: BYOK_PROTOCOL_ENDPOINTS["openai-responses"],
  },
  { protocol: "anthropic", value: BYOK_PROTOCOL_ENDPOINTS.anthropic },
  { value: "" },
];

/** A context window as the BYOK form shows it. */
export function byokContextLabel(tokens: number) {
  return tokens < 1024
    ? `${tokens}-token context`
    : `${Math.round(tokens / 1024)}K context`;
}
