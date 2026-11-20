import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const wslExecutable = path.join(
  process.env.SystemRoot ?? "C:/Windows",
  "System32",
  "wsl.exe",
);
const wslAvailable =
  process.platform === "win32" &&
  spawnSync(wslExecutable, ["--exec", "/bin/true"], {
    timeout: 30_000,
    windowsHide: true,
  }).status === 0;

it.skipIf(!wslAvailable)(
  "runs the Desktop TeamHub script through WSL with Windows paths and environment",
  () => {
    const root = mkdtempSync(path.join(tmpdir(), "linger teamhub wsl "));
    const wsl = (args: string[], env = process.env, timeout = 15_000) =>
      execFileSync(wslExecutable, ["--exec", ...args], {
        encoding: "utf8",
        timeout,
        windowsHide: true,
        env,
      }).trim();
    try {
      const cli = path.join(root, "resources", "app", "dist", "teamhub-cli");
      mkdirSync(cli, { recursive: true });
      copyFileSync(process.execPath, path.join(root, "Linger.exe"));
      writeFileSync(
        path.join(cli, "teamhub"),
        readFileSync(path.resolve("scripts/teamhub.sh"), "utf8").replace(
          /\r\n/g,
          "\n",
        ),
      );
      writeFileSync(
        path.join(cli, "teamhub.js"),
        `const {readFileSync} = require("node:fs");
         const [message, file] = process.argv.slice(2);
         process.stdout.write(JSON.stringify({node:process.env.ELECTRON_RUN_AS_NODE,message,file,attachment:readFileSync(file,"utf8")}));`,
      );
      const attachment = path.join(root, "attachment with spaces.txt");
      writeFileSync(attachment, "attachment bytes");
      const unixPath = wsl(["wslpath", "-u", path.join(cli, "teamhub")]);
      const linuxAttachment = wsl(["wslpath", "-u", attachment]);
      const windowsAttachment = wsl(["wslpath", "-w", linuxAttachment]);
      const message = "/home/u/x.png is message text";
      const result = wsl(
        ["/bin/sh", unixPath, message, windowsAttachment],
        { ...process.env, ELECTRON_RUN_AS_NODE: "" },
        30_000,
      );
      expect(JSON.parse(result)).toEqual({
        node: "1",
        message,
        file: windowsAttachment,
        attachment: "attachment bytes",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  120_000,
);
