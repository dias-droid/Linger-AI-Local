import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("ships the Windows binding script beside the installer entry point", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "linger-installer-build-"));
  try {
    const build = fileURLToPath(
      new URL("../scripts/build.mjs", import.meta.url),
    );
    await promisify(execFile)(process.execPath, [build, output]);
    const installer = path.join(output, "installer.js");
    expect((await stat(installer)).isFile()).toBe(true);
    const adapter = "windows-stack-binding.py";
    const source = new URL(
      `../../../packages/local-installation/src/${adapter}`,
      import.meta.url,
    );
    expect(await readFile(path.join(path.dirname(installer), adapter))).toEqual(
      await readFile(source),
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}, 30000);
