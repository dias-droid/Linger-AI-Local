import { execFile } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
// The Daemon puts the Computer tools on NODE_PATH so Pi can load this
// extension. Node has read it by now; put back the value Pi inherited so the
// commands Pi starts never resolve a package from the tools.
if (process.env.LINGER_PI_INHERITED_NODE_PATH !== undefined) {
  if (process.env.LINGER_PI_INHERITED_NODE_PATH)
    process.env.NODE_PATH = process.env.LINGER_PI_INHERITED_NODE_PATH;
  else delete process.env.NODE_PATH;
  delete process.env.LINGER_PI_INHERITED_NODE_PATH;
}
// The Daemon executable that judges a bash command before Pi runs it; the
// commands Pi starts do not inherit it.
const shellTextHook = process.env.LINGER_PI_SHELL_TEXT_HOOK;
delete process.env.LINGER_PI_SHELL_TEXT_HOOK;
// An installed Pi may alias bare package imports to its own version. Resolve
// the pinned public entry by URL so this adapter keeps its shipped API.
const { createMcpExtension } = await import(
  new URL(
    "../node_modules/@earendil-works/pi-coding-agent/dist/index.js",
    import.meta.url,
  ).href
);

// This explicit extension uses Pi's public MCP implementation. It does not
// discover ambient configuration or create another Agent execution loop.
export function loadManagedMcpConfig(configPath) {
  if (!configPath || !isAbsolute(configPath)) {
    throw new Error("Managed Pi MCP configuration is missing");
  }
  const stat = lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
    throw new Error("Managed Pi MCP configuration is unsafe");
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error("Managed Pi MCP configuration must be private");
  }
  const parsed = JSON.parse(readFileSync(configPath, "utf8"));
  const servers = Object.entries(parsed.mcpServers ?? {}).map(
    ([name, config]) => {
      const url = new URL(config.url);
      if (
        config.type !== "http" ||
        url.protocol !== "http:" ||
        url.hostname !== "127.0.0.1" ||
        url.username ||
        url.password ||
        config.command ||
        config.headers ||
        config.auth ||
        config.oauth
      ) {
        throw new Error("Managed Pi MCP requires a bound local proxy");
      }
      return {
        name,
        config: {
          type: "http",
          url: url.href,
          exposure: "direct",
          timeout: config.tool_timeout_sec ?? 180,
        },
        source: configPath,
        scope: "extension",
      };
    },
  );
  return { servers, autoEnableCodemode: false, errors: [] };
}

/**
 * Refuses a bash call whose TeamHub text the shell would rewrite, by the
 * Daemon's shell-text-hook, the check Codex runs before its shell commands.
 * Only a command that names teamhub and holds $ or a backquote can be
 * refused, so no other call starts the hook. A hook that cannot run lets the
 * call proceed.
 */
export async function refuseRewrittenShellText(event, hook = shellTextHook) {
  const command = event.toolName === "bash" ? event.input?.command : undefined;
  if (
    !hook ||
    typeof command !== "string" ||
    !command.includes("teamhub") ||
    !/[$`]/u.test(command)
  ) {
    return undefined;
  }
  const reason = await new Promise((resolve) => {
    const child = execFile(
      hook,
      ["shell-text-hook"],
      { timeout: 10_000 },
      (error, _stdout, stderr) => {
        resolve(error?.code === 2 ? stderr.trim() : "");
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify({ tool_input: { command } }));
  });
  return reason ? { block: true, reason } : undefined;
}

const mcpExtension = createMcpExtension({
  loadConfig: () =>
    loadManagedMcpConfig(process.env.LINGER_PI_MANAGED_MCP_CONFIG),
  updateConfig: () => {
    throw new Error("Operation MCP configuration is immutable");
  },
});

// The Daemon loads this extension for the shell text check, and for the
// Operation's MCP servers when it has any.
export default async function managedExtension(pi) {
  pi.on("tool_call", (event) => refuseRewrittenShellText(event));
  if (process.env.LINGER_PI_MANAGED_MCP_CONFIG) await mcpExtension(pi);
}
