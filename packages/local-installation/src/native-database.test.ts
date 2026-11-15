import { runProcess } from "./process.js";
vi.mock("./process.js", () => ({ runProcess: vi.fn() }));
import { inspectNativeProcess, startNativeProcess } from "./native-process.js";
vi.mock("./native-process.js", () => ({
  inspectNativeProcess: vi.fn(async () => ({ running: true })),
  startNativeProcess: vi.fn(async () => {}),
}));
import { removeRetrying, renameRetrying } from "./fs-retry.js";
vi.mock("./fs-retry.js", () => ({
  removeRetrying: vi.fn(async () => {}),
  renameRetrying: vi.fn(async () => {}),
}));
vi.mock("./instance.js", () => ({
  privateDirectory: vi.fn(async () => {}),
  atomicPrivate: vi.fn(async () => {}),
  readPrivate: vi.fn(async () => "LINGER_POSTGRES_PASSWORD=secret\n"),
}));
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  postgresProgram,
  prepareNativeDatabase,
  windowsElevated,
} from "./native-database.js";
import type { Instance } from "./instance.js";

const run = vi.mocked(runProcess);
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const getuid = Object.getOwnPropertyDescriptor(process, "getuid")!;
afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  Object.defineProperty(process, "getuid", getuid);
  vi.clearAllMocks();
});
// Windows has no process.getuid.
const asWindows = () => {
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  Object.defineProperty(process, "getuid", { ...getuid, value: undefined });
};
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const instance = {
  root: path.join("C:", "Users", "Nora", "Nouveau dossier é", "instance"),
  mode: "source-native",
  source: { ports: { postgres: 15432 } },
} as unknown as Instance;
const options = {
  instance,
  postgresBin: path.join("C:", "pg", "bin"),
  env: {},
  signal: new AbortController().signal,
  onOutput: () => {},
};

describe("postgresProgram", () => {
  it("names the Windows executables", () => {
    expect(postgresProgram("bin", "initdb", "win32")).toBe(
      path.join("bin", "initdb.exe"),
    );
    expect(postgresProgram("bin", "initdb", "linux")).toBe(
      path.join("bin", "initdb"),
    );
  });
});

describe("windowsElevated", () => {
  const groups = (label: string) =>
    `"Everyone","Well-known group","S-1-1-0","Mandatory group"\r\n"Mandatory Label\\${label}","Label","${
      label === "High Mandatory Level" ? "S-1-16-12288" : "S-1-16-8192"
    }",""\r\n`;

  it("detects an elevated token by its integrity label SID", async () => {
    const fake = vi.fn<typeof runProcess>(async () =>
      ok(groups("High Mandatory Level")),
    );
    expect(await windowsElevated(fake)).toBe(true);
    expect(fake.mock.calls[0]![0]).toMatch(/System32[\\/]whoami\.exe$/);
  });

  it("accepts a normal token, and does not block when whoami fails", async () => {
    expect(
      await windowsElevated(async () => ok(groups("Medium Mandatory Level"))),
    ).toBe(false);
    expect(
      await windowsElevated(async () => {
        throw new Error("spawn ENOENT");
      }),
    ).toBe(false);
  });
});

describe("prepareNativeDatabase on Windows", () => {
  it("runs the .exe programs from the private PostgreSQL", async () => {
    asWindows();
    run.mockImplementation(async (command) =>
      command.endsWith("whoami.exe")
        ? ok(
            '"Mandatory Label\\Medium Mandatory Level","Label","S-1-16-8192",""',
          )
        : ok(),
    );
    await prepareNativeDatabase(options);
    const programs = run.mock.calls.map(([command]) =>
      path.win32.basename(command),
    );
    expect(programs).toEqual([
      "whoami.exe",
      "initdb.exe",
      "pg_isready.exe",
      "psql.exe",
      "createdb.exe",
    ]);
    expect(vi.mocked(startNativeProcess).mock.calls[0]![0]).toMatchObject({
      executable: path.join(options.postgresBin, "postgres.exe"),
    });
    expect(vi.mocked(inspectNativeProcess)).toHaveBeenCalled();
  });

  it("stops before initdb when Linger runs as administrator", async () => {
    asWindows();
    run.mockResolvedValue(
      ok('"Mandatory Label\\High Mandatory Level","Label","S-1-16-12288",""'),
    );
    await expect(prepareNativeDatabase(options)).rejects.toThrow(
      /cannot run as administrator/,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(startNativeProcess).not.toHaveBeenCalled();
  });
});

describe("prepareNativeDatabase initdb", () => {
  const data = path.join(instance.root, "native/postgres-data");
  const pending = `${data}.partial`;
  const pgdata = () =>
    run.mock.calls
      .filter(([command]) => path.basename(command) === "initdb")
      .map(([, args]) => args[args.indexOf("--pgdata") + 1]);

  it("builds the data directory aside and moves it in once initdb succeeds", async () => {
    run.mockResolvedValue(ok());
    await prepareNativeDatabase(options);
    expect(pgdata()).toEqual([pending]);
    expect(vi.mocked(removeRetrying).mock.calls).toEqual([[pending], [data]]);
    expect(vi.mocked(renameRetrying)).toHaveBeenCalledWith(pending, data, {
      signal: options.signal,
    });
    const initdb = run.mock.calls.findIndex(
      ([command]) => path.basename(command) === "initdb",
    );
    expect(
      vi.mocked(removeRetrying).mock.invocationCallOrder[1],
    ).toBeGreaterThan(run.mock.invocationCallOrder[initdb]!);
  });

  // A killed initdb has already written PG_VERSION; publishing it would make
  // every later attempt skip initdb and fail on an incomplete cluster.
  it("leaves the data directory alone when initdb fails", async () => {
    run.mockImplementation(async (command) =>
      path.basename(command) === "initdb"
        ? { code: 1, stdout: "", stderr: "" }
        : ok(),
    );
    await expect(prepareNativeDatabase(options)).rejects.toThrow(
      /initdb failed/,
    );
    expect(vi.mocked(removeRetrying).mock.calls).toEqual([[pending]]);
    expect(renameRetrying).not.toHaveBeenCalled();
    expect(startNativeProcess).not.toHaveBeenCalled();
  });

  describe("with a PG_VERSION already present", () => {
    let root: string;
    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), "native-database-"));
      await mkdir(path.join(root, "native/postgres-data"), { recursive: true });
      await writeFile(
        path.join(root, "native/postgres-data/PG_VERSION"),
        "17\n",
      );
      run.mockResolvedValue(ok());
    });
    afterEach(() => rm(root, { recursive: true, force: true }));
    const prepare = () =>
      prepareNativeDatabase({ ...options, instance: { ...instance, root } });

    it("keeps a cluster that has served", async () => {
      await writeFile(
        path.join(root, "native/postgres-data/postmaster.opts"),
        "",
      );
      await prepare();
      expect(pgdata()).toEqual([]);
      expect(renameRetrying).not.toHaveBeenCalled();
    });

    // A cluster no postmaster ever started holds no data, and one left by a
    // killed initdb would otherwise fail every start.
    it("makes again one that never started", async () => {
      await prepare();
      expect(pgdata()).toEqual([
        path.join(root, "native/postgres-data.partial"),
      ]);
      expect(renameRetrying).toHaveBeenCalled();
    });
  });
});
