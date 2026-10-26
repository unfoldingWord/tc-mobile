import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { region, stripComments, uniqueIndexOf } from "./support";

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
const HEADING = /^#{1,6} /;

/** Every `export interface` in the (comment-stripped) types text, from the code. */
function exportedInterfaces(typesText: string): string[] {
  return [...typesText.matchAll(/^export interface (\w+)/gm)].map(
    (m) => m[1] as string
  );
}

/** Member names of `export interface <name> { ... }`, read from the code. */
function interfaceFields(typesText: string, name: string): string[] {
  const start = typesText.indexOf(`export interface ${name} {`);
  if (start < 0) throw new Error(`no interface ${name} in the types file`);
  const end = typesText.indexOf("\n}", start);
  const body = region(typesText, { from: start, to: end });
  return [...body.matchAll(MEMBER)].map((m) => m[1] as string);
}

/** Field names in the first column of the tables under the heading naming `name`. */
function docFields(docText: string, name: string): string[] {
  const lines = docText.split("\n");
  const heading = lines.findIndex(
    (l) => /^#{2,3} /.test(l) && l.includes(`\`${name}\``)
  );
  if (heading < 0) throw new Error(`no heading for \`${name}\` in the doc`);
  const out: string[] = [];
  for (const line of lines.slice(heading + 1)) {
    if (HEADING.test(line)) break;
    const row = /^\| `(\w+)`/.exec(line);
    if (row) out.push(row[1] as string);
  }
  return out;
}

/** The doc text under `### \`LicenceId\``, up to the next heading and no further. */
function licenceSection(docText: string): string {
  const from = uniqueIndexOf(docText, "### `LicenceId`");
  const body = from + docText.slice(from).indexOf("\n") + 1;
  const rest = docText.slice(body);
  const next = rest.search(/^#{1,6} /m);
  return region(docText, {
    from,
    to: next === -1 ? docText.length : body + next,
  });
}

/**
 * Every disagreement between the types file and the contract page, as text.
 * Takes both texts so the gate itself can be run on a state it must catch.
 */
function contractGaps(typesText: string, docText: string): string[] {
  const gaps: string[] = [];
  const names = exportedInterfaces(typesText);
  if (names.length === 0) throw new Error("no exported interface found");
  for (const name of names) {
    const inTypes = interfaceFields(typesText, name).sort();
    if (inTypes.length === 0) gaps.push(`${name}: no fields read from types`);
    let inDoc: string[];
    try {
      inDoc = docFields(docText, name).sort();
    } catch {
      gaps.push(`${name}: no heading in the doc`);
      continue;
    }
    if (inTypes.join() !== inDoc.join()) {
      gaps.push(`${name}: types [${inTypes}] vs doc [${inDoc}]`);
    }
  }
  const start = uniqueIndexOf(typesText, "export type LicenceId");
  const ids = [
    ...region(typesText, {
      from: start,
      to: typesText.indexOf(";", start),
    }).matchAll(/"([^"]+)"/g),
  ].map((m) => m[1] as string);
  const section = licenceSection(docText);
  for (const id of ids) {
    if (!section.includes(`\`${id}\``))
      gaps.push(`LicenceId: ${id} not in its section`);
  }
  return gaps;
}

describe("the contract page and src/types/template.ts", () => {
  it("reads non-empty sources", () => {
    expect(types.length).toBeGreaterThan(500);
    expect(doc.length).toBeGreaterThan(2000);
  });

  it("discovers the exported interfaces from the types file", () => {
    expect(exportedInterfaces(types)).toEqual([
      "TemplateRef",
      "SegmentSpan",
      "TemplateSegment",
      "TemplateChapter",
      "TemplatePackage",
      "TemplateTitleTable",
    ]);
  });

  it("every exported interface and LicenceId id agrees with the page", () => {
    expect(contractGaps(types, doc)).toEqual([]);
  });

  it("gate: a new exported interface the page does not cover is a gap", () => {
    const grown = `${types}\nexport interface TemplateNew {\n  readonly a: string;\n}\n`;
    expect(contractGaps(grown, doc)).toEqual([
      "TemplateNew: no heading in the doc",
    ]);
  });

  it("gate: a new field in an exported interface is a gap", () => {
    const grown = types.replace(
      "export interface TemplateRef {",
      "export interface TemplateRef {\n  readonly extra: string;"
    );
    expect(contractGaps(grown, doc)).toHaveLength(1);
  });

  it("gate: a LicenceId id named only after the section ends is a gap", () => {
    const at = doc.indexOf("### `LicenceId`");
    const body = at + doc.slice(at).indexOf("\n") + 1;
    const next = body + doc.slice(body).search(/^#{1,6} /m);
    const moved = doc.replace("`CC0-1.0`", "CC0");
    const leaked = `${moved.slice(0, next)}${moved.slice(next)}\nLater: \`CC0-1.0\`\n`;
    expect(contractGaps(types, leaked)).toEqual([
      "LicenceId: CC0-1.0 not in its section",
    ]);
  });

  it("source: url and revision are in both", () => {
    const line = /readonly source: \{([^}]*)\}/.exec(types)?.[1] ?? "";
    const inTypes = [...line.matchAll(/readonly (\w+):/g)].map(
      (m) => m[1] as string
    );
    expect(inTypes.slice().sort()).toEqual(["revision", "url"]);
    expect(docFields(doc, "source").slice().sort()).toEqual(
      inTypes.slice().sort()
    );
  });
});
