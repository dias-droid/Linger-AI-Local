import { describe, expect, it } from "vitest";

import enMain from "./locales/en/main.json" with { type: "json" };
import zhCNMain from "./locales/zh-CN/main.json" with { type: "json" };

// CLDR plural categories differ per language (zh-CN has only "other"), so
// keys compare without their plural suffix.
const pluralSuffix = /_(?:zero|one|two|few|many|other)$/;

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function leafPaths(value: JsonValue, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return leafPaths(child, path.replace(pluralSuffix, ""));
  });
}

function hasEmptyLeaf(value: JsonValue): boolean {
  if (typeof value === "string") return value.trim() === "";
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).some(hasEmptyLeaf);
}

describe("main-process catalog", () => {
  it("keeps zh-CN at key parity with en", () => {
    // Plural families collapse to one path: en's _one/_other and zh's _other
    // describe the same key.
    const unique = (paths: string[]) => [...new Set(paths)].sort();
    expect(unique(leafPaths(zhCNMain as JsonValue))).toEqual(
      unique(leafPaths(enMain as JsonValue)),
    );
  });

  it("keeps both languages free of empty values", () => {
    expect(hasEmptyLeaf(enMain as JsonValue)).toBe(false);
    expect(hasEmptyLeaf(zhCNMain as JsonValue)).toBe(false);
  });

  it("keeps every placeholder of every en string in zh-CN", () => {
    const placeholders = (value: JsonValue): Map<string, Set<string>> => {
      const found = new Map<string, Set<string>>();
      const walk = (node: JsonValue, path: string): void => {
        if (typeof node === "string") {
          found.set(
            path,
            new Set([...node.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!)),
          );
        } else if (typeof node === "object" && node !== null) {
          for (const [key, child] of Object.entries(node))
            walk(
              child,
              (path === "" ? key : `${path}.${key}`).replace(pluralSuffix, ""),
            );
        }
      };
      walk(value, "");
      return found;
    };
    const en = placeholders(enMain as JsonValue);
    const zh = placeholders(zhCNMain as JsonValue);
    for (const [key, names] of en) {
      const translated = zh.get(key);
      expect(translated, `zh-CN key ${key}`).toEqual(names);
    }
  });
});
