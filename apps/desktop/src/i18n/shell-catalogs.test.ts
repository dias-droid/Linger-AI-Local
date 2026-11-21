import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { shellDictionary } from "../main/i18n/shell-html.js";

// Every key the pages ask for must be in the catalog, and every catalog key
// must be asked for, so a rename on either side fails here instead of
// showing English or dead weight in the shell.
const shellDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../shell",
);

const pageKeys = (page: string): Set<string> => {
  const html = readFileSync(path.join(shellDirectory, page), "utf8");
  const attributes = [
    ...html.matchAll(
      /data-i18n(?:-title|-aria-label|-placeholder)?="([^"]+)"/g,
    ),
  ].map((match) => match[1]!);
  const calls = [...html.matchAll(/\bT\(\s*"([^"]+)"/g)].map(
    (match) => match[1]!,
  );
  return new Set([...attributes, ...calls]);
};

describe("shell catalog", () => {
  const wanted = new Set<string>();
  for (const page of ["setup.html", "offline.html", "titlebar.html"])
    for (const key of pageKeys(page)) wanted.add(key);

  it("covers every key the pages use", () => {
    const missing = [...wanted].filter(
      (key) => shellDictionary[key] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("carries no key the pages stopped using", () => {
    expect(
      Object.keys(shellDictionary).filter((key) => !wanted.has(key)),
    ).toEqual([]);
  });

  it("keeps every value non-empty", () => {
    for (const value of Object.values(shellDictionary))
      expect(value.trim()).not.toBe("");
  });
});
