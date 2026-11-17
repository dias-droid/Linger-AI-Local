import { execFile, spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  fileURLToPath(new URL("../", import.meta.url)),
);
const installScriptPath = path.join(repositoryRoot, "install.sh");

const temporaryDirectories: string[] = [];
const cleanups: Array<() => Promise<void>> = [];

interface ScriptRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface ComputerInvocation {
  argv: string[];
  path: string;
  piAgentDir: string;
}

interface FakeEngineScenario {
  acceptedStack?: boolean;
  lastRunState?: string;
  picks?: Array<{
    role: string;
    id: string;
    quant: string;
    quality: number;
    decodeTokS: number;
    decodeBasis: string;
    card: number;
    shared: boolean;
  }>;
  planPreflightWarn?: string;
  createGatewayPiOnApply?: boolean;
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "linger-install-test-"));
  temporaryDirectories.push(dir);
  return dir;
}

async function resolvePythonExecutable(): Promise<string> {
  const { stdout } = await execFileAsync("sh", [
    "-c",
    "command -v python3 || command -v python",
  ]);
  const resolved = stdout.trim();
  if (!resolved) {
    throw new Error("python3 is required to run install.sh script tests");
  }
  return resolved;
}

async function createFakeStackScript(
  root: string,
  scenario: FakeEngineScenario,
): Promise<{
  scriptPath: string;
  logPath: string;
}> {
  const pythonBin = await resolvePythonExecutable();
  const scriptPath = path.join(root, "fake-stack.sh");
  const logPath = path.join(root, "stack-calls.log");
  const statusJsonPath = path.join(root, "fixture-status.json");
  const hardwareJsonPath = path.join(root, "fixture-hardware.json");
  const gatewayPiDir = path.join(
    root,
    "home",
    ".local/share/localmodels/tools/gateway-home/.pi/agent",
  );
  const piBinPath = path.join(root, "home", ".local/bin/pi");

  const statusPayload = scenario.acceptedStack
    ? {
        deployments: [{ name: "qwen3.8-27b", state: "active", ok: true }],
        last_run: {
          ok: true,
          plan_id: "plan-123456789abc",
          state: scenario.lastRunState ?? "completed",
          started_at: "2026-11-17T00:00:00Z",
          finished_at: "2026-11-17T00:05:00Z",
        },
      }
    : {
        deployments: [],
        last_run: null,
      };
  await writeFile(statusJsonPath, JSON.stringify(statusPayload));

  const picks = scenario.picks ?? [
    {
      role: "smartest",
      id: "qwen3.8-32b",
      quant: "UD-Q4_K_M",
      quality: 92,
      decodeTokS: 38,
      decodeBasis: "estimated",
      card: 0,
      shared: false,
    },
  ];
  const hardwarePayload = {
    system: "Linux",
    arch: "x86_64",
    ram_total_bytes: 128 * 1024 ** 3,
    ram_available_bytes: 96 * 1024 ** 3,
    disk_free_bytes: 400 * 1024 ** 3,
    cards: [
      {
        index: 0,
        name: "NVIDIA RTX PRO 6000",
        total_bytes: 96 * 1024 ** 3,
        free_bytes: 52 * 1024 ** 3,
        held_by: picks.some((p) => p.shared) ? ["vllm"] : [],
        auto: !picks.some((p) => p.shared),
      },
    ],
    picks: picks.map((p) => ({
      role: p.role,
      id: p.id,
      quant: p.quant,
      quality: p.quality,
      decode_tok_s: p.decodeTokS,
      decode_basis: p.decodeBasis,
      card: p.card,
      shared: p.shared,
    })),
  };
  await writeFile(hardwareJsonPath, JSON.stringify(hardwarePayload));

  const warnFinding = scenario.planPreflightWarn
    ? [
        {
          check: "preflight.note",
          level: "warn",
          detail: scenario.planPreflightWarn,
          fix: "Run stack up after reboot",
        },
      ]
    : [];
  const planTemplate = {
    plan_id: "plan-abcdef123456",
    llm: {
      model: {
        id: "qwen3.8-27b",
        display_name: "Qwen 3.8 27B",
        quant: "UD-Q4_K_M",
      },
      placement: {
        label: "GPU 0",
      },
      launch: {
        window: 131072,
      },
    },
    decision: {
      model: {
        id: "qwen3-4b",
        display_name: "Qwen 3 4B",
      },
    },
    aux: [
      {
        name: "embed",
        endpoint: { contract: "embedding" },
        model: { id: "bge-m3", display_name: "BGE M3" },
      },
    ],
    budget: {
      download_bytes: 18 * 1024 ** 3,
      disk_needed_bytes: 20 * 1024 ** 3,
      ram_needed_bytes: 8 * 1024 ** 3,
      ram_available_bytes: 96 * 1024 ** 3,
    },
    preflight: {
      counts: { pass: 3, warn: warnFinding.length, fail: 0 },
      findings: warnFinding,
    },
  };
  const planTemplatePath = path.join(root, "fixture-plan.json");
  await writeFile(planTemplatePath, JSON.stringify(planTemplate));

  const createPiOnApply = scenario.createGatewayPiOnApply !== false;
  const content = `#!/bin/sh
set -eu
printf '%s\n' "$*" >> ${JSON.stringify(logPath)}
case "\${1:-}" in
  --bootstrap-json)
    printf '{"schema":"localmodels.kit-location/v1","kitRoot":%s,"python":%s,"moduleDir":"modules"}\n' \
      ${JSON.stringify(JSON.stringify(root))} \
      ${JSON.stringify(JSON.stringify(pythonBin))}
    ;;
  status)
    if [ "\${2:-}" = "--json" ]; then
      cat ${JSON.stringify(statusJsonPath)}
    else
      printf 'qwen3.8-27b active\n'
      printf 'Services down after a reboot? python3 -m localmodels stack up starts them without reinstalling\n'
    fi
    ;;
  hardware)
    cat ${JSON.stringify(hardwareJsonPath)}
    ;;
  plan)
    out_file=""
    prev=""
    for arg in "$@"; do
      if [ "$prev" = "--out" ]; then
        out_file="$arg"
      fi
      prev="$arg"
    done
    cp ${JSON.stringify(planTemplatePath)} "$out_file"
    cat "$out_file"
    ;;
  apply)
    if [ "${createPiOnApply ? "1" : "0"}" = "1" ]; then
      mkdir -p ${JSON.stringify(path.dirname(piBinPath))} ${JSON.stringify(gatewayPiDir)}
      cat <<'PIEOF' > ${JSON.stringify(piBinPath)}
#!/bin/sh
exit 0
PIEOF
      chmod 0755 ${JSON.stringify(piBinPath)}
      printf '{"providers":{}}\n' > ${JSON.stringify(path.join(gatewayPiDir, "models.json"))}
    fi
    printf 'Applied plan %s\n' "\${4:-}"
    ;;
  up)
    printf 'Local model stack is ready\n'
    ;;
  remove)
    printf 'Removed. Run stack remove --purge to free downloaded files.\n'
    ;;
  *)
    printf 'stack.sh: unexpected subcommand %s\n' "\${1:-}" >&2
    exit 2
    ;;
esac
`;
  await writeFile(scriptPath, content, { mode: 0o755 });
  return { scriptPath, logPath };
}

async function startMockLingerServer(
  root: string,
  authorized: boolean,
): Promise<{
  baseUrl: string;
  installerRequests: () => number;
  computerLogPath: string;
}> {
  const computerLogPath = path.join(root, "computer-calls.jsonl");
  const binDir = path.join(root, "bin");
  await mkdir(binDir, { recursive: true });
  let requestCount = 0;

  const installerScript = `#!/usr/bin/env bash
# linger-computer-launcher-v2
set -euo pipefail
web_origin="\${LINGER_WEB_URL:?LINGER_WEB_URL is required}"
rest="\${web_origin#*://}"
host="\${rest%%:*}"
port="\${rest#"$host"}"
port="\${port#:}"
env_name="local-\${port}"
bin_dir="\${LINGER_COMPUTER_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$bin_dir"
launcher="$bin_dir/linger-computer-$env_name"
cat <<'CLI_EOF' > "$launcher"
#!/usr/bin/env bash
# linger-computer-launcher-v2
set -euo pipefail
printf '{"argv":[' >> ${JSON.stringify(computerLogPath)}
first=1
for a in "$@"; do
  if [ "$first" -eq 0 ]; then printf ',' >> ${JSON.stringify(computerLogPath)}; fi
  printf '"%s"' "$(printf '%s' "$a" | sed 's/"/\\"/g')" >> ${JSON.stringify(computerLogPath)}
  first=0
done
printf '],"path":"%s","piAgentDir":"%s"}\n' \
  "$(printf '%s' "\${PATH:-}" | sed 's/"/\\"/g')" \
  "$(printf '%s' "\${PI_CODING_AGENT_DIR:-}" | sed 's/"/\\"/g')" >> ${JSON.stringify(computerLogPath)}

if [ "\${1:-}" = "auth" ] && [ "\${2:-}" = "status" ]; then
  printf '{"version":1,"authorized":${authorized ? "true" : "false"}}\n'
  exit 0
fi
if [ "\${1:-}" = "daemon" ] && [ "\${2:-}" = "status" ]; then
  printf 'Daemon: running\n'
  exit 0
fi
exit 0
CLI_EOF
chmod 0755 "$launcher"
`;

  const server: Server = createServer((req, res) => {
    if (req.url === "/install/linger-computer.sh") {
      requestCount += 1;
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(installerScript);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    installerRequests: () => requestCount,
    computerLogPath,
  };
}

async function runInstallScript(
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    input?: string;
  },
): Promise<ScriptRunResult> {
  return await new Promise<ScriptRunResult>((resolve, reject) => {
    const child = spawn("bash", [installScriptPath, ...args], {
      cwd: repositoryRoot,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(options.input ?? "");
  });
}

function buildTestEnv(root: string, stackScript: string): NodeJS.ProcessEnv {
  const homeDir = path.join(root, "home");
  const binDir = path.join(root, "bin");
  return {
    HOME: homeDir,
    PATH: `/usr/local/bin:/usr/bin:/bin`,
    LINGER_STACK_SCRIPT: stackScript,
    LINGER_COMPUTER_BIN_DIR: binDir,
  };
}

async function readComputerCalls(
  logPath: string,
): Promise<ComputerInvocation[]> {
  const raw = await readFile(logPath, "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ComputerInvocation);
}

describe("root install.sh", () => {
  it("prints help without exposing internal stack.sh or PI_CODING_AGENT_DIR details", async () => {
    const root = await createTempRoot();
    const { scriptPath } = await createFakeStackScript(root, {});
    const result = await runInstallScript(["--help"], {
      env: buildTestEnv(root, scriptPath),
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--web-url");
    expect(result.stdout).toContain("--connect");
    expect(result.stdout).toContain("--up");
    expect(result.stdout).toContain("--status");
    expect(result.stdout).toContain("--remove");
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toContain("stack.sh");
    expect(combined).not.toContain("PI_CODING_AGENT_DIR");
    expect(combined).not.toContain("gateway-home");
  });

  it("guides through shared GPU selection, plan approval, and linger-computer login", async () => {
    const root = await createTempRoot();
    const homeDir = path.join(root, "home");
    await mkdir(homeDir, { recursive: true });
    const { scriptPath, logPath } = await createFakeStackScript(root, {
      picks: [
        {
          role: "smartest",
          id: "qwen3.8-32b",
          quant: "UD-Q4_K_M",
          quality: 92,
          decodeTokS: 38,
          decodeBasis: "estimated",
          card: 0,
          shared: true,
        },
        {
          role: "fastest",
          id: "qwen3.8-9b",
          quant: "Q4_K_M",
          quality: 78,
          decodeTokS: 72,
          decodeBasis: "measured-decode",
          card: 0,
          shared: true,
        },
      ],
      planPreflightWarn: "Shared card detected; check stack.sh settings",
    });
    const server = await startMockLingerServer(root, false);

    const result = await runInstallScript(["--web-url", server.baseUrl], {
      env: buildTestEnv(root, scriptPath),
      input: ["2", "y", "24G", "y", "y"].join("\n") + "\n",
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("[1/4] Checking Linger server");
    expect(result.stdout).toContain(
      "[2/4] Checking hardware and model options",
    );
    expect(result.stdout).toContain(
      "[3/4] Installing and verifying the local model",
    );
    expect(result.stdout).toContain("[4/4] Connecting this computer to Linger");

    const stackCalls = (await readFile(logPath, "utf8")).trim().split("\n");
    const planCall = stackCalls.find((line) => line.startsWith("plan "));
    expect(planCall).toBeDefined();
    expect(planCall).toContain("--prefer fastest");
    expect(planCall).toContain("--gpu 0");
    expect(planCall).toContain("--share-gpu");
    expect(planCall).toContain("--gpu-memory 24G");
    expect(planCall).toContain("--decision auto");
    expect(planCall).toContain("--aux embedding,reranker");

    const applyCall = stackCalls.find((line) => line.startsWith("apply "));
    expect(applyCall).toContain("--approve plan-abcdef123456");

    expect(server.installerRequests()).toBe(2);
    const computerCalls = await readComputerCalls(server.computerLogPath);
    const expectedPiDir = path.join(
      homeDir,
      ".local/share/localmodels/tools/gateway-home/.pi/agent",
    );
    const expectedPiBin = path.join(homeDir, ".local/bin/pi");

    expect(computerCalls.map((c) => c.argv.slice(0, 2))).toEqual([
      ["auth", "status"],
      ["login", "--web-url"],
      ["runtime", "check"],
    ]);
    expect(computerCalls[1]?.argv).toEqual([
      "login",
      "--web-url",
      server.baseUrl,
      "--pi-path",
      expectedPiBin,
    ]);
    expect(computerCalls[1]?.piAgentDir).toBe(expectedPiDir);
    expect(computerCalls[1]?.path).toContain(path.join(homeDir, ".local/bin"));
    expect(computerCalls[2]?.argv).toEqual([
      "runtime",
      "check",
      "pi",
      "--live",
      "--pi-path",
      expectedPiBin,
    ]);
    expect(computerCalls[2]?.piAgentDir).toBe(expectedPiDir);

    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toContain("stack.sh");
    expect(combined).not.toContain("PI_CODING_AGENT_DIR");
    expect(combined).not.toContain("gateway-home");
  });

  it("exits cleanly when plan approval is declined without downloading or connecting", async () => {
    const root = await createTempRoot();
    await mkdir(path.join(root, "home"), { recursive: true });
    const { scriptPath, logPath } = await createFakeStackScript(root, {});
    const server = await startMockLingerServer(root, false);

    const result = await runInstallScript(["--web-url", server.baseUrl], {
      env: buildTestEnv(root, scriptPath),
      input: ["n", "n"].join("\n") + "\n",
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Nothing was downloaded or changed");
    const stackCalls = await readFile(logPath, "utf8");
    expect(stackCalls).not.toContain("apply ");
    expect(server.installerRequests()).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("stack.sh");
  });

  it("reuses an accepted local model stack and restarts an authorized computer daemon", async () => {
    const root = await createTempRoot();
    const homeDir = path.join(root, "home");
    const piDir = path.join(
      homeDir,
      ".local/share/localmodels/tools/gateway-home/.pi/agent",
    );
    const piBin = path.join(homeDir, ".local/bin/pi");
    await mkdir(piDir, { recursive: true });
    await mkdir(path.dirname(piBin), { recursive: true });
    await writeFile(path.join(piDir, "models.json"), "{}");
    await writeFile(piBin, "#!/bin/sh\nexit 0\n");
    await chmod(piBin, 0o755);

    const { scriptPath, logPath } = await createFakeStackScript(root, {
      acceptedStack: true,
    });
    const server = await startMockLingerServer(root, true);

    const result = await runInstallScript(["--web-url", server.baseUrl], {
      env: buildTestEnv(root, scriptPath),
      input: "\n",
    });

    expect(result.code).toBe(0);
    const stackCalls = (await readFile(logPath, "utf8")).trim().split("\n");
    expect(stackCalls).toContain("up");
    expect(stackCalls.some((line) => line.startsWith("hardware"))).toBe(false);
    expect(stackCalls.some((line) => line.startsWith("plan"))).toBe(false);
    expect(stackCalls.some((line) => line.startsWith("apply"))).toBe(false);

    const computerCalls = await readComputerCalls(server.computerLogPath);
    expect(computerCalls.map((c) => c.argv.slice(0, 2))).toEqual([
      ["auth", "status"],
      ["daemon", "restart"],
      ["runtime", "check"],
    ]);
    expect(computerCalls[1]?.piAgentDir).toBe(piDir);
  });

  it("sanitizes day-2 --status and --remove output without exposing stack commands", async () => {
    const root = await createTempRoot();
    await mkdir(path.join(root, "home"), { recursive: true });
    const { scriptPath, logPath } = await createFakeStackScript(root, {
      acceptedStack: true,
    });

    const statusResult = await runInstallScript(["--status"], {
      env: buildTestEnv(root, scriptPath),
    });
    expect(statusResult.code).toBe(0);
    expect(statusResult.stdout).toContain("./install.sh --up");
    expect(statusResult.stdout).not.toContain("stack up");
    expect(statusResult.stdout).not.toContain("localmodels");

    const removeResult = await runInstallScript(
      ["--remove", "--purge", "--yes"],
      {
        env: buildTestEnv(root, scriptPath),
      },
    );
    expect(removeResult.code).toBe(0);
    expect(removeResult.stdout).toContain("./install.sh --remove --purge");
    expect(removeResult.stdout).not.toContain("stack remove");

    const stackCalls = (await readFile(logPath, "utf8")).trim().split("\n");
    expect(stackCalls).toContain("status");
    expect(stackCalls).toContain("remove --purge --yes");
  });
});
