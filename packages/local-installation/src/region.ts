import { readFile } from "node:fs/promises";
import path from "node:path";
import { orderByRegion, sourceRegion, type Region } from "@linger/service-kit";
import { downloadVerified, type DownloadTiming } from "./download.js";
import { npmMirrorRegistry, probeNpmRegistries } from "./npm-registry.js";
import { atomicPrivate, privateDirectory } from "./private-files.js";

export type { Region };

// The record localmodels shares: see scripts/installs/README.md.
export const REGION_SCHEMA = "simplex.region/v1";
const STALE_MS = 7 * 24 * 60 * 60_000;
export interface RegionRecord {
  schema: typeof REGION_SCHEMA;
  region: Region;
  /** ISO 8601 UTC. */
  resolved_at: string;
  method: "env" | "probe" | "fallback";
}

/** Where a home keeps its resolved download region. */
export function regionFile(home: string): string {
  return path.join(path.resolve(home), "runtime", "region.json");
}

/** SIMPLEX_REGION when it names a region; undefined for `auto` or unset. */
export function forcedRegion(
  environment: NodeJS.ProcessEnv = process.env,
): Region | undefined {
  const value = environment.SIMPLEX_REGION?.trim() || "auto";
  if (value === "auto") return undefined;
  if (value === "cn" || value === "global") return value;
  throw new Error("SIMPLEX_REGION must be auto, global or cn.");
}

async function readRecord(file: string): Promise<RegionRecord | undefined> {
  let value: Partial<RegionRecord>;
  try {
    value = JSON.parse(await readFile(file, "utf8")) as Partial<RegionRecord>;
  } catch {
    return undefined;
  }
  return value?.schema === REGION_SCHEMA &&
    (value.region === "cn" || value.region === "global") &&
    (value.method === "env" ||
      value.method === "probe" ||
      value.method === "fallback") &&
    typeof value.resolved_at === "string"
    ? (value as RegionRecord)
    : undefined;
}

function fresh(record: RegionRecord, now: number): boolean {
  const age = now - Date.parse(record.resolved_at);
  return age >= 0 && age < STALE_MS;
}

// The record only saves a later probe; a home that cannot hold it still
// downloads.
async function save(
  file: string,
  region: Region,
  method: RegionRecord["method"],
) {
  const record: RegionRecord = {
    schema: REGION_SCHEMA,
    region,
    resolved_at: new Date().toISOString(),
    method,
  };
  try {
    await privateDirectory(path.dirname(file));
    await atomicPrivate(file, `${JSON.stringify(record)}\n`);
  } catch {
    // Best effort, as above.
  }
}

// One resolution per home and process, so concurrent downloads share a probe.
const resolutions = new Map<string, Promise<Region>>();

async function resolve(
  file: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<Region> {
  const forced = forcedRegion();
  const saved = await readRecord(file);
  if (forced) {
    if (
      saved?.region !== forced ||
      saved.method !== "env" ||
      !fresh(saved, Date.now())
    )
      await save(file, forced, "env");
    return forced;
  }
  if (saved && fresh(saved, Date.now())) return saved.region;
  const [best] = await probeNpmRegistries(signal, fetcher);
  // Neither registry answered: global for now, probed again next run.
  if (!best || best.bytes <= 0) return "global";
  const region = best.registry === npmMirrorRegistry ? "cn" : "global";
  await save(file, region, "probe");
  return region;
}

/**
 * The download region of `home`: SIMPLEX_REGION when it names one, else a
 * region.json resolved within the last 7 days, else the npm registry probe
 * (cn when the China mirror delivers more). Resolved once per process.
 */
export function resolveRegion(
  home: string,
  options: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<Region> {
  const file = regionFile(home);
  let pending = resolutions.get(file);
  if (!pending) {
    pending = resolve(
      file,
      options.signal ?? new AbortController().signal,
      options.fetcher ?? fetch,
    );
    resolutions.set(file, pending);
    // An aborted probe leaves nothing behind; the next caller probes again.
    pending.catch(() => {
      if (resolutions.get(file) === pending) resolutions.delete(file);
    });
  }
  return pending;
}

/**
 * Records that a download fell back to `region` because the preferred one
 * failed: this process and the next runs prefer it. A region forced through
 * SIMPLEX_REGION stays forced.
 */
export async function recordRegionFallback(
  home: string,
  region: Region,
): Promise<void> {
  if (forcedRegion()) return;
  const file = regionFile(home);
  const current = await resolutions.get(file)?.catch(() => undefined);
  if (current === region) return;
  resolutions.set(file, Promise.resolve(region));
  await save(file, region, "fallback");
}

/**
 * downloadVerified with the sources in the home's region first. Only a
 * download offered by both regions resolves the region, so one served from
 * a single region never probes. When the other region served it, that
 * becomes the home's region.
 */
export async function downloadInRegion(
  home: string,
  options: Parameters<typeof downloadVerified>[0],
  fetcher: typeof fetch = fetch,
  timing?: DownloadTiming,
): Promise<string> {
  const sources = [options.url, ...(options.mirrors ?? [])];
  if (new Set(sources.map(sourceRegion)).size < 2)
    return downloadVerified(options, fetcher, timing);
  const region = await resolveRegion(home, {
    signal: options.signal,
    fetcher,
  });
  const [url, ...mirrors] = orderByRegion(region, sources);
  const served = await downloadVerified(
    { ...options, url: url!, mirrors },
    fetcher,
    timing,
  );
  const servedRegion = sourceRegion(served);
  if (servedRegion !== region) await recordRegionFallback(home, servedRegion);
  return served;
}
