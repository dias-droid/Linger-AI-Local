import type { components } from "@linger/wire-contracts/teamhub-public/types";

type Schemas = components["schemas"];
type ByokProtocol = Schemas["ByokProtocol"];
type ModelSourceRuntime = Schemas["ModelSourceRuntime"];

/** Each Runtime's own wire format, which Bifrost forwards untranslated. */
const runtimeProtocols: Record<ModelSourceRuntime, ByokProtocol> = {
  claude: "anthropic",
  codex: "openai-responses",
  pi: "openai-chat",
};

const protocolEndpoints: Record<ByokProtocol, string> = {
  anthropic: "/messages",
  "openai-chat": "/chat/completions",
  "openai-responses": "/responses",
};

/** The path most providers serve their API under. */
export const DEFAULT_BYOK_PATH = "/v1";

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
  { protocol: "openai-chat", value: protocolEndpoints["openai-chat"] },
  {
    protocol: "openai-responses",
    value: protocolEndpoints["openai-responses"],
  },
  { protocol: "anthropic", value: protocolEndpoints.anthropic },
  { value: "" },
];

/** The endpoint a Runtime's requests go to unless the owner picks another. */
export function defaultByokEndpoint(runtime: ModelSourceRuntime) {
  return protocolEndpoints[runtimeProtocols[runtime]];
}

const URL_PATH = /^(?:\/[^/?#\s\\]+)*$/u;
const MAX_URL_PATH = 256;

/** A typed path as it is sent: trimmed, led by one slash, no trailing slash. */
export function normalizeByokPath(value: string) {
  const trimmed = value.trim().replace(/\/+$/u, "");
  return trimmed && !trimmed.startsWith("/") ? `/${trimmed}` : trimmed;
}

/** Whether a normalized path only appends whole segments to the base URL. */
export function validByokPath(path: string) {
  return path.length <= MAX_URL_PATH && URL_PATH.test(path);
}

/** A base URL as it is sent: trimmed, without a trailing slash. */
export function normalizeByokBaseUrl(value: string) {
  return value.trim().replace(/\/+$/u, "");
}

/**
 * The wire format of a request address: its ending names one, else the
 * Runtime's own format applies. Nothing is probed.
 */
export function byokProtocolFor(url: string, runtime: ModelSourceRuntime) {
  const named = (Object.keys(protocolEndpoints) as ByokProtocol[]).find(
    (protocol) => url.endsWith(protocolEndpoints[protocol]),
  );
  return named
    ? { fromUrl: true, protocol: named }
    : { fromUrl: false, protocol: runtimeProtocols[runtime] };
}

/** A context window as the BYOK form shows it. */
export function byokContextLabel(tokens: number) {
  return tokens < 1024
    ? `${tokens}-token context`
    : `${Math.round(tokens / 1024)}K context`;
}
