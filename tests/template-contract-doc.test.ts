import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "./support";

/**
 * Template package contract v0 (#1467): the contract page and the types name
 * the same fields. Names only; the prose and the cites are kept by review.
 */

const ROOT = path.join(__dirname, "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

// Comments are stripped first: a field named only in a docblock is not a field.
const types = stripComments(read("src/types/template.ts"));
const doc = read("docs/contracts/template-package-v0.md");

const MEMBER = /^ {2}readonly (\w+)\??:/gm;

/** Member names of `export interface <name> { ... }`, read from the code. */
function interfaceFields(name: string): string[] {
  const start = types.indexOf(`export interface ${name} {`);
  if (start < 0) throw new Error(`no interface ${name} in the types file`);
  const end = types.indexOf("\n}", start);
  const body = types.slice(start, end);
  return [...body.matchAll(MEMBER)].map((m) => m[1] as string);
}

/** Field names in the first column of the tables under the heading naming `name`. */
function docFields(name: string): string[] {
  const lines = doc.split("\n");
  const heading = lines.findIndex(
    (l) => /^#{2,3} /.test(l) && l.includes(`\`${name}\``)
  );
  if (heading < 0) throw new Error(`no heading for \`${name}\` in the doc`);
  const out: string[] = [];
  for (const line of lines.slice(heading + 1)) {
    if (/^#{1,6} /.test(line)) break;
    const row = /^\| `(\w+)`/.exec(line);
    if (row) out.push(row[1] as string);
  }
  return out;
}

const INTERFACES = [
  "TemplateRef",
  "TemplatePackage",
  "TemplateChapter",
  "TemplateSegment",
  "SegmentSpan",
  "TemplateTitleTable",
];

describe("the contract page and src/types/template.ts", () => {
  it("reads non-empty sources", () => {
    expect(types.length).toBeGreaterThan(500);
    expect(doc.length).toBeGreaterThan(2000);
  });

  it.each(INTERFACES)("%s: the same fields in both", (name) => {
    const inTypes = interfaceFields(name);
    expect(inTypes.length).toBeGreaterThan(0);
    expect(docFields(name).slice().sort()).toEqual(inTypes.slice().sort());
  });

  it("source: url and revision are in both", () => {
    const line = /readonly source: \{([^}]*)\}/.exec(types)?.[1] ?? "";
    const inTypes = [...line.matchAll(/readonly (\w+):/g)].map(
      (m) => m[1] as string
    );
    expect(inTypes.slice().sort()).toEqual(["revision", "url"]);
    expect(docFields("source").slice().sort()).toEqual(inTypes.slice().sort());
  });

  it("LicenceId: every id the type names is in the doc", () => {
    const start = types.indexOf("export type LicenceId");
    const end = types.indexOf(";", start);
    const ids = [...types.slice(start, end).matchAll(/"([^"]+)"/g)].map(
      (m) => m[1] as string
    );
    expect(ids.length).toBeGreaterThan(0);
    const section = doc.slice(doc.indexOf("### `LicenceId`"));
    for (const id of ids) expect(section).toContain(`\`${id}\``);
  });
});
