import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { atomicPrivate, privateDirectory, readPrivate } from "./instance.js";
import { runProcess } from "./process.js";
import {
  linuxProcessStates,
  nativeProcessIdentity as observed,
  nativeLeaseProcesses,
  windowsLeaseTree,
  windowsSnapshot,
  type WindowsProcess,
  type WindowsSnapshot,
} from "./native-process-identity.js";

export type NativeService =
  | "postgres"
  | "livekit"
  | "teamhub"
  | "node-services"
  | "web";
const services = new Set([
  "postgres",
  "livekit",
  "teamhub",
  "node-services",
  "web",
]);
interface Lease {
  schemaVersion: 1;
  name: NativeService;
  pid: number;
  birth: string;
  lease: string;
  configuration: string;
}
export interface NativeProcessState {
  running: boolean;
  pid?: number;
}
const leaseKey = "LINGER_NATIVE_PROCESS_LEASE";
function paths(root: string, name: NativeService) {
  if (!services.has(name)) throw new Error("Invalid native service");
  return {
    record: path.join(root, "native", "processes", `${name}.json`),
    log: path.join(root, "native", "logs", `${name}.log`),
  };
}
async function stored(
  root: string,
  name: NativeService,
): Promise<Lease | undefined> {
  const text = await readPrivate(paths(root, name).record);
  if (!text) return;
  const record = JSON.parse(text) as Lease;
  if (
    record.schemaVersion !== 1 ||
    record.name !== name ||
    !Number.isSafeInteger(record.pid) ||
    record.pid < 2 ||
    typeof record.birth !== "string" ||
    !record.birth ||
    !/^[a-f0-9]{64}$/.test(record.lease) ||
    !/^[a-f0-9]{64}$/.test(record.configuration)
  )
    throw new Error("Invalid native process identity record");
  return record;
}
async function stillLive(pid: number): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      // Windows has no zombies; an exited PID is gone.
    } else if (process.platform === "linux") {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
      if (stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")) return false;
    } else {
      const state = await runProcess(
        "/bin/ps",
        ["-p", String(pid), "-o", "stat="],
        { timeoutMs: 5_000 },
      );
      if (state.code === 0 && state.stdout.trim().startsWith("Z")) return false;
    }
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
async function groupLive(group: number): Promise<boolean> {
  // Windows has no process groups; the leader is the whole group.
  if (process.platform === "win32") return stillLive(group);
  if (process.platform === "linux")
    return (await linuxProcessStates()).some(
      (process) => process.group === group && process.state !== "Z",
    );
  const result = await runProcess("/bin/ps", ["-axo", "pid=,pgid=,stat="], {
    timeoutMs: 5_000,
  });
  if (result.code !== 0)
    throw new Error(
      "Native process group could not be inspected; identity record retained.",
    );
  return result.stdout
    .trim()
    .split("\n")
    .some((line) => {
      const [, pgid, state] = line.trim().split(/\s+/);
      return Number(pgid) === group && !state?.startsWith("Z");
    });
}
/** The recorded supervisor and what it started, or nothing when it is gone. */
function recordedTree(
  processes: WindowsProcess[],
  record: Pick<Lease, "pid" | "birth" | "lease">,
): WindowsProcess[] {
  const tree = windowsLeaseTree(processes, record.lease);
  const owner = tree[0];
  return owner?.pid === record.pid &&
    `win32:${owner.pid}:${owner.created}` === record.birth
    ? tree
    : [];
}
/**
 * Whether the recorded supervisor still runs its service. On Windows a
 * supervisor left with no process under it serves nothing, and one from an
 * earlier release may never exit on its own; counting it as running kept
 * every start waiting for a service that was gone.
 */
async function serving(record: Lease): Promise<boolean> {
  if (process.platform !== "win32")
    return (await observed(record.pid, record.lease)) === record.birth;
  return recordedTree((await windowsSnapshot()).processes, record).length > 1;
}
export async function inspectNativeProcess(
  root: string,
  name: NativeService,
): Promise<NativeProcessState> {
  const record = await stored(root, name);
  if (!record) return { running: false };
  return { running: await serving(record), pid: record.pid };
}
export interface NativeListener {
  name: NativeService;
  port: number;
}
export interface NativeListenerState {
  running: boolean;
  /**
   * Windows only: the PID of a process outside the service's recorded tree
   * that listens on its port. The service cannot serve there, and a health
   * check on that port reaches the other process.
   */
  foreign?: number;
}
/** Whether each service runs and, on Windows, whether its port is its own. */
export async function inspectNativeListeners(
  root: string,
  listeners: NativeListener[],
): Promise<NativeListenerState[]> {
  if (process.platform !== "win32")
    return Promise.all(
      listeners.map(async ({ name }) => ({
        running: (await inspectNativeProcess(root, name)).running,
      })),
    );
  const snapshot = await windowsSnapshot();
  return Promise.all(
    listeners.map(async ({ name, port }) => {
      const record = await stored(root, name);
      const tree = record ? recordedTree(snapshot.processes, record) : [];
      const owner = snapshot.listeners.get(port);
      return {
        running: tree.length > 1,
        ...(owner !== undefined &&
        !tree.some((candidate) => candidate.pid === owner)
          ? { foreign: owner }
          : {}),
      };
    }),
  );
}
interface NativeConfiguration {
  executable: string;
  args: string[];
  cwd: string;
  settings?: string;
}
function configurationHash(options: NativeConfiguration): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        executable: options.executable,
        args: options.args,
        cwd: options.cwd,
        settings: options.settings,
      }),
    )
    .digest("hex");
}
/** True only when a recorded, running process would restart for this configuration. */
export async function nativeConfigurationChanged(
  options: NativeConfiguration & { root: string; name: NativeService },
): Promise<boolean> {
  const existing = await stored(options.root, options.name);
  if (!existing || !(await serving(existing))) return false;
  return configurationHash(options) !== existing.configuration;
}
export async function startNativeProcess(options: {
  root: string;
  name: NativeService;
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  redactions?: string[];
  /** Generated configuration the process reads; a change counts as a new configuration. */
  settings?: string;
  restartOnConfigurationChange?: boolean;
}): Promise<NativeProcessState> {
  options.signal?.throwIfAborted();
  const location = paths(options.root, options.name);
  const configuration = configurationHash(options);
  const existing = await stored(options.root, options.name);
  if (existing && (await serving(existing))) {
    if (configuration !== existing.configuration) {
      if (!options.restartOnConfigurationChange)
        throw new Error(
          `Native ${options.name} configuration changed; stop this instance before restarting.`,
        );
      await stopNativeProcess(options.root, options.name);
      return startNativeProcess({
        ...options,
        restartOnConfigurationChange: false,
      });
    }
    return { running: true, pid: existing.pid };
  }
  if (existing && process.platform === "win32") {
    // The lease names the supervisor on its command line, so whatever is
    // still on it, such as a supervisor that outlived its service, is this
    // service's own to end. A recorded PID alone proves nothing on Windows,
    // which reuses PIDs quickly.
    await stopNativeProcess(options.root, options.name);
  } else if (existing) {
    if (
      (await stillLive(existing.pid)) ||
      (await groupLive(existing.pid)) ||
      (await nativeLeaseProcesses(existing.lease)).length
    )
      throw new Error(
        `Native ${options.name} process identity cannot be verified; refusing to replace it.`,
      );
    await rm(location.record, { force: true });
  }
  await privateDirectory(path.dirname(location.record));
  await privateDirectory(path.dirname(location.log));
  const lease = randomBytes(32).toString("hex");
  const job = path.join(
    path.dirname(location.record),
    `${options.name}.${lease}.job`,
  );
  // The worker argv contains only a private file path, never service arguments or credentials.
  await atomicPrivate(
    job,
    JSON.stringify({
      executable: options.executable,
      args: options.args,
      cwd: options.cwd,
      env: { ...options.env, [leaseKey]: lease },
      log: location.log,
      redactions: [
        ...new Set(
          [
            ...(options.redactions ?? []),
            ...Object.entries(options.env)
              .filter(([key]) =>
                /password|passwd|secret|token|api.?key|credential|database_url/i.test(
                  key,
                ),
              )
              .map(([, value]) => value),
          ].filter((value): value is string => Boolean(value)),
        ),
      ],
    }),
  );
  const worker = new URL("./native-process-worker.mjs", import.meta.url);
  if (!existsSync(worker)) {
    await rm(job, { force: true });
    throw new Error(
      "Native process supervisor is missing from this installation.",
    );
  }
  const child = spawn(process.execPath, [fileURLToPath(worker), job], {
    cwd: options.cwd,
    env: {
      [leaseKey]: lease,
      PATH: process.env.PATH,
      // Windows processes cannot load system libraries without it.
      ...(process.platform === "win32"
        ? { SystemRoot: process.env.SystemRoot }
        : {}),
    },
    detached: true,
    windowsHide: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let birth: string | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(`Native ${options.name} supervisor start timed out.`),
          ),
        5_000,
      );
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      child.once("error", finish);
      child.once("exit", () =>
        finish(new Error(`Native ${options.name} supervisor failed to start.`)),
      );
      child.once("message", (message) =>
        message === "ready"
          ? finish()
          : finish(new Error(`Native ${options.name} failed to start.`)),
      );
    });
    birth = await observed(child.pid!, lease);
    if (!birth)
      throw new Error(`Native ${options.name} identity could not be verified.`);
    const record: Lease = {
      schemaVersion: 1,
      name: options.name,
      pid: child.pid!,
      birth,
      lease,
      configuration,
    };
    await atomicPrivate(location.record, JSON.stringify(record) + "\n");
    child.disconnect();
    child.unref();
    if (options.signal?.aborted) {
      await stopNativeProcess(options.root, options.name);
      options.signal.throwIfAborted();
    }
    return { running: true, pid: child.pid };
  } catch (error) {
    // A failed record write must not leave an unmanageable owned group behind.
    if (process.platform === "win32") {
      await stopWindowsTree(options.name, lease).catch((failure: unknown) => {
        throw new Error(
          `Native ${options.name} failed to stop after identity persistence failed.`,
          { cause: failure },
        );
      });
      if (child.connected) child.disconnect();
      child.unref();
      throw error;
    }
    const deadline = Date.now() + 5_000;
    for (;;) {
      const owned = await nativeLeaseProcesses(lease);
      if (!owned.length) break;
      const descendants = owned.filter(
        (candidate) => candidate.pid !== child.pid,
      );
      for (const candidate of descendants.length ? descendants : owned) {
        if ((await observed(candidate.pid, lease, false)) !== candidate.birth)
          continue;
        try {
          process.kill(candidate.pid, "SIGKILL");
        } catch (failure) {
          if ((failure as NodeJS.ErrnoException).code !== "ESRCH")
            throw failure;
        }
      }
      await delay(20);
      if (Date.now() >= deadline)
        throw new Error(
          `Native ${options.name} failed to stop after identity persistence failed.`,
          { cause: error },
        );
    }
    if (child.connected) child.disconnect();
    child.unref();
    throw error;
  } finally {
    await rm(job, { force: true });
  }
}

/**
 * Marks a stop refused because the recorded PID now belongs to another
 * program: none of the service's own processes are left.
 */
export const NATIVE_PROCESS_REPLACED = "NATIVE_PROCESS_REPLACED";
export async function stopNativeProcess(
  root: string,
  name: NativeService,
): Promise<void> {
  const record = await stored(root, name);
  if (!record) return;
  if (process.platform === "win32") {
    await stopWindowsTree(name, record.lease);
    await rm(paths(root, name).record, { force: true });
    return;
  }
  const current = await observed(record.pid, record.lease);
  let owned = await nativeLeaseProcesses(record.lease);
  if (current !== record.birth && !owned.length) {
    if ((await stillLive(record.pid)) || (await groupLive(record.pid)))
      throw Object.assign(
        new Error(
          `Native ${name} process identity changed; refusing to signal this PID.`,
        ),
        { code: NATIVE_PROCESS_REPLACED },
      );
    await rm(paths(root, name).record, { force: true });
    return;
  }
  const signalOwned = async (
    candidate: { pid: number; birth: string },
    signal: NodeJS.Signals,
  ) => {
    // Revalidate the birth and unguessable lease immediately before signalling.
    if (candidate.pid === record.pid && candidate.birth !== record.birth)
      return;
    if (
      (await observed(candidate.pid, record.lease, false)) !== candidate.birth
    )
      return;
    try {
      process.kill(candidate.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const interrupted = new Map<number, string>();
  const deadline = Date.now() + 12_000;
  for (;;) {
    for (const candidate of owned) {
      if (
        candidate.pid === record.pid ||
        interrupted.get(candidate.pid) === candidate.birth
      )
        continue;
      await signalOwned(candidate, "SIGINT");
      interrupted.set(candidate.pid, candidate.birth);
    }
    if (
      !owned.some((candidate) => candidate.pid !== record.pid) ||
      Date.now() >= deadline
    )
      break;
    await delay(100);
    owned = await nativeLeaseProcesses(record.lease);
  }
  // Keep the supervisor alive until separate-group descendants are reclaimed.
  const forceDeadline = Date.now() + 5_000;
  while (owned.some((candidate) => candidate.pid !== record.pid)) {
    for (const candidate of owned)
      if (candidate.pid !== record.pid) await signalOwned(candidate, "SIGKILL");
    await delay(100);
    owned = await nativeLeaseProcesses(record.lease);
    if (
      Date.now() >= forceDeadline &&
      owned.some((candidate) => candidate.pid !== record.pid)
    )
      throw new Error(
        `Native ${name} still has live descendants; identity record retained.`,
      );
  }
  const owner = owned.find((candidate) => candidate.pid === record.pid);
  if (owner) await signalOwned(owner, "SIGKILL");
  for (let count = 0; count < 30 && (await groupLive(record.pid)); count++)
    await delay(100);
  if (
    (await groupLive(record.pid)) ||
    (await nativeLeaseProcesses(record.lease)).length
  )
    throw new Error(`Native ${name} did not stop; identity record retained.`);
  await rm(paths(root, name).record, { force: true });
}

function terminate(pid: number) {
  try {
    // Windows has no signals: every kill is TerminateProcess.
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
/** Deepest first, so that no process loses the parent that links it here. */
export function windowsTerminationOrder(tree: WindowsProcess[]): number[] {
  return tree.map((candidate) => candidate.pid).reverse();
}
/**
 * Ends the supervisor holding the lease and everything under it. Windows
 * links a child only through its parent's PID, so ending a parent first
 * (as the signal loop for process groups does) cut its children off the
 * tree: TeamHub, web and node-services outlived every stop and kept their
 * ports. Each pass ends one snapshot's processes leaves first; the
 * supervisor, whose command line carries the lease that finds the tree, goes
 * only once nothing is left under it.
 */
async function stopWindowsTree(name: NativeService, lease: string) {
  const deadline = Date.now() + 12_000;
  for (;;) {
    const tree = windowsLeaseTree((await windowsSnapshot()).processes, lease);
    if (!tree.length) return;
    if (Date.now() >= deadline)
      throw new Error(`Native ${name} did not stop; identity record retained.`);
    const order = windowsTerminationOrder(tree);
    for (const pid of tree.length > 1 ? order.slice(0, -1) : order)
      terminate(pid);
    await delay(100);
  }
}

const SUPERVISOR = "native-process-worker.mjs";
const comparable = (value: string) => value.replaceAll("/", "\\").toLowerCase();
/**
 * What Windows must end before this instance's services start: processes an
 * earlier run started and lost track of. Each is proved this instance's own
 * by its command line, never by a program name alone:
 * - a supervisor whose job file is in this instance's process directory but
 *   whose service is gone or whose lease no record holds any more;
 * - a process listening on one of this instance's ports that runs from one
 *   of this installation's folders yet belongs to no recorded service, with
 *   its wrappers up to its supervisor (a stop of an earlier release ended
 *   the supervisor and left TeamHub, web and node-services running).
 * The result lists PIDs in the order to end them, deepest first.
 */
export function windowsOrphans(
  snapshot: WindowsSnapshot,
  records: Array<Pick<Lease, "pid" | "birth" | "lease">>,
  options: { root: string; ports: number[]; paths: string[]; self: number },
): number[] {
  const { processes } = snapshot;
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  const owned = new Set<number>();
  const leases = new Set<string>();
  for (const record of records) {
    const tree = recordedTree(processes, record);
    if (tree.length < 2) continue;
    leases.add(record.lease);
    for (const entry of tree) owned.add(entry.pid);
  }
  // This process and the ones that started it are never ended.
  const keep = new Set<number>();
  for (
    let entry = byPid.get(options.self);
    entry && !keep.has(entry.pid);
    entry = byPid.get(entry.parent)
  )
    keep.add(entry.pid);
  const children = (parent: WindowsProcess) =>
    processes.filter(
      (entry) => entry.parent === parent.pid && entry.created >= parent.created,
    );
  const order: number[] = [];
  const end = (top: WindowsProcess) => {
    const tree = [top];
    for (let index = 0; index < tree.length; index++)
      for (const child of children(tree[index]!))
        if (!tree.includes(child)) tree.push(child);
    for (const pid of windowsTerminationOrder(tree))
      if (!order.includes(pid) && !owned.has(pid) && !keep.has(pid))
        order.push(pid);
  };
  const jobs =
    comparable(path.join(options.root, "native", "processes")) + "\\";
  for (const entry of processes) {
    const command = comparable(entry.command);
    if (!command.includes(SUPERVISOR) || !command.includes(jobs)) continue;
    const lease = /\.([a-f0-9]{64})\.job\b/.exec(command)?.[1];
    if (lease && !leases.has(lease)) end(entry);
  }
  const folders = options.paths.map((folder) => comparable(folder) + "\\");
  const ours = (entry: WindowsProcess) =>
    !keep.has(entry.pid) &&
    folders.some((folder) => comparable(entry.command).includes(folder));
  for (const port of options.ports) {
    const pid = snapshot.listeners.get(port);
    let top = pid === undefined ? undefined : byPid.get(pid);
    if (!top || owned.has(top.pid) || !ours(top)) continue;
    // A supervisor heads every service tree, at most four links up
    // (node-services: main.js, its supervisor, cmd.exe, source-native.mjs).
    for (
      let depth = 0;
      depth < 4 && !comparable(top.command).includes(SUPERVISOR);
      depth++
    ) {
      const parent = byPid.get(top.parent);
      if (
        !parent ||
        parent.created > top.created ||
        owned.has(parent.pid) ||
        !ours(parent)
      )
        break;
      top = parent;
    }
    end(top);
  }
  return order;
}
/**
 * Ends what `windowsOrphans` finds for this instance; nothing elsewhere.
 * Returns the PIDs it ended.
 */
export async function reclaimNativeOrphans(
  root: string,
  options: { ports: number[]; paths: string[] },
): Promise<number[]> {
  if (process.platform !== "win32") return [];
  const records: Lease[] = [];
  for (const name of services)
    try {
      const record = await stored(root, name as NativeService);
      if (record) records.push(record);
    } catch {
      // A damaged record proves nothing; its supervisor counts as unrecorded.
    }
  const ended: number[] = [];
  const deadline = Date.now() + 12_000;
  for (;;) {
    const orphans = windowsOrphans(await windowsSnapshot(), records, {
      root,
      ...options,
      self: process.pid,
    });
    if (!orphans.length) return ended;
    if (Date.now() >= deadline)
      throw new Error(
        `Processes an earlier Linger started on this computer did not stop (PIDs ${orphans.join(", ")}).`,
      );
    const refused: number[] = [];
    for (const pid of orphans)
      try {
        terminate(pid);
        if (!ended.includes(pid)) ended.push(pid);
      } catch {
        // Such as one started as administrator.
        refused.push(pid);
      }
    if (refused.length === orphans.length)
      throw new Error(
        `Processes an earlier Linger started on this computer could not be ended (PIDs ${refused.join(", ")}). End them in Task Manager, then try again.`,
      );
    await delay(100);
  }
}
