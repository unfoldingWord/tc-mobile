import { readFileSync } from "node:fs";
import path from "node:path";

import prettier from "prettier";
import { describe, expect, it } from "vitest";

import { ENGLISH_ONLY } from "@/lib/i18n/english-only";
import { LOCALE_OVERRIDES } from "@/lib/i18n/locales";
import { stringsEn } from "@/lib/strings";

import { rewritePending } from "../scripts/i18n-pending-core.mjs";

/**
 * The pending-list generator (`npm run i18n:pending`, #1481) in both states
 * (#1747, George r1 #1531): on the file as it is, and as the next edit may
 * leave it, it rebuilds `PENDING` and keeps everything else; on a file whose
 * anchors it cannot find, it throws instead of writing a damaged file.
 */

const target = path.resolve(import.meta.dirname, "../src/lib/i18n/pending.ts");
const real = readFileSync(target, "utf8");
const keys = Object.keys(stringsEn).filter((key) => !ENGLISH_ONLY.has(key));

const format = async (text: string): Promise<string> =>
  prettier.format(text, {
    ...((await prettier.resolveConfig(target)) ?? {}),
    filepath: target,
  });

const FILE = [
  "/** Head. */",
  'export const PENDING: Readonly<Record<string, readonly string[] | "all">> = {',
  '  fr: "all",',
  "};",
  "",
  "/** Gate. */",
  "export const ENFORCE_COMPLETE = false;",
  "",
].join("\n");

const TABLES = { fr: { a: "x" }, ar: {} };

describe("the generator on a well-formed file", () => {
  it("reproduces today's pending.ts from today's tables", async () => {
    expect(await format(rewritePending(real, LOCALE_OVERRIDES, keys))).toBe(
      real
    );
  });

  it("rebuilds PENDING and keeps the head, the gate comment and the gate", () => {
    const out = rewritePending(FILE, TABLES, ["a", "b"]);
    expect(out).toContain("/** Head. */\nexport const PENDING");
    expect(out).toContain('  "ar": "all",\n  "fr": ["b"],\n};');
    expect(out).toContain(
      "/** Gate. */\nexport const ENFORCE_COMPLETE = false;"
    );
    expect(out).not.toContain('fr: "all"');
  });

  it("keeps ENFORCE_COMPLETE true when it is true", () => {
    const on = FILE.replace("= false;", "= true;");
    expect(rewritePending(on, TABLES, ["a"])).toContain(
      "export const ENFORCE_COMPLETE = true;"
    );
  });

  it("keeps the gate when its docblock is deleted or reworded", () => {
    for (const gate of ["", "// The gate.\n", "/** Say }; here. */\n"]) {
      const out = rewritePending(FILE.replace("/** Gate. */\n", gate), TABLES, [
        "a",
      ]);
      expect(out).toContain(`${gate}export const ENFORCE_COMPLETE = false;`);
      expect(out.match(/export const PENDING/g)).toHaveLength(1);
    }
  });

  it("keeps a declaration added after the gate", () => {
    const more = `${FILE}\nexport const LATER = 1;\n`;
    expect(rewritePending(more, TABLES, ["a"])).toContain(
      "export const ENFORCE_COMPLETE = false;\n\nexport const LATER = 1;\n"
    );
  });

  it("lists a key named like an Object.prototype member as pending", () => {
    expect(
      rewritePending(FILE, { fr: { a: "x" } }, ["a", "constructor", "toString"])
    ).toContain('"fr": ["constructor","toString"],');
  });
});

describe("the generator on a file it cannot read", () => {
  const throwsOn = (text: string) =>
    expect(() => rewritePending(text, TABLES, ["a"]));

  it("throws with no PENDING declaration", () => {
    throwsOn(
      FILE.replace("export const PENDING", "export const WAITING")
    ).toThrow(/PENDING/);
  });

  it("throws when PENDING has no closing brace", () => {
    throwsOn(FILE.replace("\n};\n", "\n}\n")).toThrow(/PENDING/);
  });

  it("throws with no ENFORCE_COMPLETE, or with two", () => {
    throwsOn(
      FILE.replace("export const ENFORCE_COMPLETE = false;", "")
    ).toThrow(/ENFORCE_COMPLETE/);
    throwsOn(`${FILE}export const ENFORCE_COMPLETE = true;\n`).toThrow(
      /ENFORCE_COMPLETE/
    );
  });

  it("throws with two PENDING declarations", () => {
    const twice = FILE.replace(
      "/** Gate. */",
      'export const PENDING: Readonly<Record<string, readonly string[] | "all">> = {\n};\n\n/** Gate. */'
    );
    throwsOn(twice).toThrow(/PENDING/);
  });

  it("throws when ENFORCE_COMPLETE comes before PENDING", () => {
    const gate = "/** Gate. */\nexport const ENFORCE_COMPLETE = false;\n";
    throwsOn(gate + FILE.replace(gate, "")).toThrow(/ENFORCE_COMPLETE/);
  });
});
