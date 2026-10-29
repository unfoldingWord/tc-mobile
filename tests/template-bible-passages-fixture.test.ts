import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  TemplateValidationError,
  parseTemplatePackage,
} from "@/lib/templates/validate";

/**
 * The real Titus package from the Bible Passages dataset, pinned as a test
 * fixture (#1450, plan task 1, done-when R1). Where it came from, and why it
 * is provisional, is in `fixtures/templates/README.md`.
 *
 * What this holds: the copy is the exact bytes that were pinned, the app's v0
 * validator accepts it unchanged, and a copy with one field broken is refused
 * with that field named.
 */

const FIXTURES = path.join(__dirname, "fixtures", "templates");
const FILE = "bible-passages-TIT.json";
const PINNED_SHA256 =
  "4509c28951531b41e16b7c9ae08e523b050ab26e2570cc0e952eabc3d78feeb6";
const PINNED_BYTES = 7_442;

const bytes = (): Buffer => readFileSync(path.join(FIXTURES, FILE));
const load = (): Record<string, unknown> =>
  JSON.parse(bytes().toString("utf8")) as Record<string, unknown>;

function refusal(input: unknown): TemplateValidationError {
  try {
    parseTemplatePackage(input);
  } catch (cause) {
    expect(cause).toBeInstanceOf(TemplateValidationError);
    return cause as TemplateValidationError;
  }
  throw new Error("expected the package to be refused");
}

describe("the pinned Bible Passages Titus fixture", () => {
  it("is the exact bytes that were pinned", () => {
    const file = bytes();
    expect(file.length).toBe(PINNED_BYTES);
    expect(createHash("sha256").update(file).digest("hex")).toBe(PINNED_SHA256);
  });

  it("is described by its README with the same hash", () => {
    const readme = readFileSync(path.join(FIXTURES, "README.md"), "utf8");
    expect(readme).toContain(FILE);
    expect(readme).toContain(PINNED_SHA256);
  });

  it("the pinned Titus package passes the v0 validator", () => {
    const json = load();
    const pkg = parseTemplatePackage(json);
    // Whole, not just a tag and a count: nothing is dropped or rewritten.
    expect(pkg).toStrictEqual(json);
    expect(pkg.id).toBe("bible-passages:TIT");
    expect(pkg.kind).toBe("bible-book");
  });

  it("a Titus copy with a changed recordingLicence is refused", () => {
    const json = structuredClone(load());
    json["recordingLicence"] = "CC-BY-4.0";
    expect(refusal(json).field).toBe("recordingLicence");
  });
});
