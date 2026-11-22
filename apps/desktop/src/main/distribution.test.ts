import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  localmodelsPythonArgs,
  validateToolSource,
} from "@linger/local-installation/localmodels-tool";
import {
  validateNativeSource,
  validateNativeVoiceTools,
} from "@linger/local-installation/native-dependencies";
import { describe, expect, it } from "vitest";

// The tracked distribution/<target>.json that build.mjs puts beside the
// bundled installer.
const desktop = fileURLToPath(new URL("../..", import.meta.url));
const read = (target: string) =>
  JSON.parse(
    readFileSync(path.join(desktop, "distribution", `${target}.json`), "utf8"),
  ) as {
    platform: string;
    arch: string;
    localmodelsTool: { url: string; sha256: string; sourceCommit: string };
    nativeSources: unknown[];
    voiceTools: unknown[];
  };

// The localmodels release scripts/installs/stack.sh pins; the installer pins
// the same one by convention.
const stack = readFileSync(
  path.join(desktop, "../../scripts/installs/stack.sh"),
  "utf8",
);
const pin = (name: string) =>
  new RegExp(`^${name}='([^']+)'$`, "m").exec(stack)?.[1];

describe("desktop distributions", () => {
  it("runs the Windows binding adapter for the pinned kit and upstream for other commands", () => {
    const { platform, localmodelsTool } = read("win32-x64");
    const binding = ["setup", "binding", "--plan", "plan.json", "--json"];
    const adapter = fileURLToPath(
      new URL(
        "../../../../packages/local-installation/src/windows-stack-binding.py",
        import.meta.url,
      ),
    );
    expect(
      localmodelsPythonArgs(platform, localmodelsTool.sourceCommit, binding),
    ).toEqual(["-P", "-s", adapter, ...binding]);
    const inspect = ["setup", "inspect", "--json"];
    expect(
      localmodelsPythonArgs(platform, localmodelsTool.sourceCommit, inspect),
    ).toEqual(["-P", "-s", "-m", "localmodels", ...inspect]);
    expect(
      localmodelsPythonArgs("linux", localmodelsTool.sourceCommit, binding),
    ).toEqual(["-P", "-s", "-m", "localmodels", ...binding]);
    expect(localmodelsPythonArgs(platform, "0".repeat(40), binding)).toEqual([
      "-P",
      "-s",
      "-m",
      "localmodels",
      ...binding,
    ]);
  });

  // Native installs need PostgreSQL and the voice tools for their target.
  // Every target bundles them beside the installer (build.mjs copies it), so they need no network.
  for (const [target, bundled] of [
    ["darwin-arm64", true],
    ["linux-x64", true],
    ["win32-x64", true],
  ] as const)
    it(`pins ${target}`, () => {
      const value = read(target);
      expect(`${value.platform}-${value.arch}`).toBe(target);
      const sources = value.nativeSources.map((source) =>
        validateNativeSource(source, "/installer"),
      );
      expect(sources.map((source) => source.target)).toEqual([target]);
      expect(sources.map((source) => source.file !== undefined)).toEqual([
        bundled,
      ]);
      // Voice runs LiveKit and ffmpeg from the bundle, offline too.
      const voice = value.voiceTools.map((source) =>
        validateNativeVoiceTools(source, "/installer"),
      );
      expect(
        voice.map((source) => [source.target, source.file !== undefined]),
      ).toEqual([[target, true]]);
      const tool = validateToolSource(value.localmodelsTool);
      expect(tool.url.endsWith(`/${pin("STACK_VERSION")}/${target}.tgz`)).toBe(
        true,
      );
      expect(value.localmodelsTool.sourceCommit).toBe(
        pin("STACK_SOURCE_COMMIT"),
      );
      const kit = pin(`STACK_KIT_${target.replace("-", "_")}`);
      if (kit) expect(tool.sha256).toBe(kit);
      // The same kit as published on npm (and its China mirror), in the
      // stack's npm version; the pinned sha256 decides either way.
      const name = `localmodels-${target}`;
      const version = pin("STACK_NPM_VERSION");
      expect(tool.mirrors).toEqual([
        `https://registry.npmjs.org/@simplexai/${name}/-/${name}-${version}.tgz`,
        `https://cdn.npmmirror.com/packages/@simplexai/${name}/${version}/${name}-${version}.tgz`,
      ]);
    });
});
