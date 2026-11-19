import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requestUrlText } from "@linger/service-kit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  downloadInRegion,
  forcedRegion,
  recordRegionFallback,
  REGION_SCHEMA,
  regionFile,
  resolveRegion,
  type RegionRecord,
} from "./region.js";

const roots: string[] = [];
beforeEach(() => vi.stubEnv("SIMPLEX_REGION", ""));
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
// Each test has its own home, so the per-process resolution never carries over.
async function home() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "linger-region-"));
  roots.push(directory);
  return directory;
}
const read = async (directory: string) =>
  JSON.parse(await readFile(regionFile(directory), "utf8")) as RegionRecord;
async function saved(
  directory: string,
  record: Partial<RegionRecord> & Pick<RegionRecord, "region">,
) {
  await mkdir(path.dirname(regionFile(directory)), { recursive: true });
  await writeFile(
    regionFile(directory),
    JSON.stringify({
      schema: REGION_SCHEMA,
      resolved_at: new Date().toISOString(),
      method: "probe",
      ...record,
    }),
  );
}
// A probe where the China mirror delivers `mirror` bytes and npmjs `global`.
function probe(mirror: number, global: number) {
  return vi.fn(async (input: string | URL | Request) => {
    const host = new URL(requestUrlText(input)).host;
    const bytes = host === "cdn.npmmirror.com" ? mirror : global;
    return bytes < 0
      ? new Response(null, { status: 503 })
      : new Response(new Uint8Array(bytes));
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
const day = 24 * 60 * 60_000;

it("takes SIMPLEX_REGION over a saved region and records it", async () => {
  const directory = await home();
  await saved(directory, { region: "global" });
  vi.stubEnv("SIMPLEX_REGION", "cn");
  const fetcher = probe(10, 1);
  expect(await resolveRegion(directory, { fetcher })).toBe("cn");
  expect(fetcher).not.toHaveBeenCalled();
  expect(await read(directory)).toMatchObject({
    schema: "simplex.region/v1",
    region: "cn",
    method: "env",
  });
});

it("treats auto and unset as not forced and refuses anything else", () => {
  expect(forcedRegion({})).toBeUndefined();
  expect(forcedRegion({ SIMPLEX_REGION: "auto" })).toBeUndefined();
  expect(forcedRegion({ SIMPLEX_REGION: "global" })).toBe("global");
  expect(() => forcedRegion({ SIMPLEX_REGION: "china" })).toThrow(
    /auto, global or cn/,
  );
});

it("reuses a region saved within 7 days without probing", async () => {
  const directory = await home();
  await saved(directory, {
    region: "cn",
    method: "fallback",
    resolved_at: new Date(Date.now() - 6 * day).toISOString(),
  });
  const fetcher = probe(1, 10);
  expect(await resolveRegion(directory, { fetcher })).toBe("cn");
  expect(fetcher).not.toHaveBeenCalled();
});

it("probes again once the saved region is stale or unreadable", async () => {
  for (const contents of [
    {
      region: "global",
      resolved_at: new Date(Date.now() - 8 * day).toISOString(),
    },
    { region: "mars" },
  ] as const) {
    const directory = await home();
    await saved(directory, contents as Pick<RegionRecord, "region">);
    const fetcher = probe(4096, 16);
    expect(await resolveRegion(directory, { fetcher })).toBe("cn");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const record = await read(directory);
    expect(record).toMatchObject({ region: "cn", method: "probe" });
    expect(Date.now() - Date.parse(record.resolved_at)).toBeLessThan(60_000);
  }
});

it("resolves once per process and home", async () => {
  const directory = await home();
  const fetcher = probe(16, 4096);
  const [first, second] = await Promise.all([
    resolveRegion(directory, { fetcher }),
    resolveRegion(directory, { fetcher }),
  ]);
  expect([first, second]).toEqual(["global", "global"]);
  expect(await resolveRegion(directory, { fetcher })).toBe("global");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await read(directory)).toMatchObject({
    region: "global",
    method: "probe",
  });
});

it("stays global without saving when neither registry answers", async () => {
  const directory = await home();
  expect(await resolveRegion(directory, { fetcher: probe(-1, -1) })).toBe(
    "global",
  );
  await expect(readFile(regionFile(directory))).rejects.toThrow();
});

const body = Buffer.from("verified bytes");
const digest = createHash("sha256").update(body).digest("hex");
const timing = { attempts: 1, retryDelayMs: 0, idleTimeoutMs: 5_000 };
const sources = {
  url: "https://nodejs.org/dist/v1/node.tgz",
  mirrors: ["https://cdn.npmmirror.com/binaries/node/v1/node.tgz"],
};
// Serves the file except from `failing` hosts; records the hosts asked.
function server(failing: string[] = []) {
  const hosts: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const host = new URL(requestUrlText(input)).host;
    hosts.push(host);
    return failing.includes(host)
      ? new Response(null, { status: 404 })
      : new Response(body);
  }) as typeof fetch;
  return { hosts, fetcher };
}
const download = async (
  directory: string,
  fetcher: typeof fetch,
  options: { url: string; mirrors?: string[] } = sources,
) =>
  downloadInRegion(
    directory,
    {
      ...options,
      output: path.join(directory, `download-${Math.random()}`),
      algorithm: "sha256",
      digest,
      maxBytes: 1024,
      signal: new AbortController().signal,
    },
    fetcher,
    timing,
  );

it("tries the region's source first and keeps the others", async () => {
  for (const [region, first] of [
    ["cn", "cdn.npmmirror.com"],
    ["global", "nodejs.org"],
  ] as const) {
    const directory = await home();
    await saved(directory, { region });
    const { hosts, fetcher } = server();
    expect(await download(directory, fetcher)).toContain(first);
    expect(hosts).toEqual([first]);
  }
});

it("does not resolve a region for a download offered by one region only", async () => {
  const directory = await home();
  const { hosts, fetcher } = server();
  await download(directory, fetcher, {
    url: "https://cdn.example/a.tgz",
    mirrors: ["https://mirror.example/a.tgz"],
  });
  expect(hosts).toEqual(["cdn.example"]);
  await expect(readFile(regionFile(directory))).rejects.toThrow();
});

it("falls back to the other region and records it for later downloads", async () => {
  const directory = await home();
  await saved(directory, { region: "cn" });
  const first = server(["cdn.npmmirror.com"]);
  expect(await download(directory, first.fetcher)).toContain("nodejs.org");
  expect(first.hosts).toEqual(["cdn.npmmirror.com", "nodejs.org"]);
  expect(await read(directory)).toMatchObject({
    region: "global",
    method: "fallback",
  });
  // The same process now starts from the region that worked.
  const second = server();
  await download(directory, second.fetcher);
  expect(second.hosts).toEqual(["nodejs.org"]);
  expect(await resolveRegion(directory)).toBe("global");
});

it("keeps a forced region when a download falls back", async () => {
  const directory = await home();
  vi.stubEnv("SIMPLEX_REGION", "cn");
  const { fetcher } = server(["cdn.npmmirror.com"]);
  expect(await download(directory, fetcher)).toContain("nodejs.org");
  expect(await read(directory)).toMatchObject({ region: "cn", method: "env" });
  await recordRegionFallback(directory, "global");
  expect(await resolveRegion(directory)).toBe("cn");
});
