import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PINNED_BUNDLE_SCHEMA_VERSION,
  parseSchemaJson,
  validateBundleMetadata,
} from "./support/scripture-bundle-schema";

/**
 * The Scripture Bundle metadata gate (#1478), tested in both states
 * (AGENTS.md, "A gate is tested in both states"): green on the worked
 * examples of ADR 0014 and on the spec's own audio example, and red, each for
 * its named reason, on the shapes the gate exists to refuse.
 *
 * Test-only. No validator ships to phones.
 */

const EXAMPLES = path.resolve(
  import.meta.dirname,
  "fixtures/scripture-bundle/examples"
);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a metadata document under test is arbitrary JSON

function example(name: string): Json {
  return JSON.parse(readFileSync(path.join(EXAMPLES, name), "utf8")) as Json;
}

function mutated(name: string, mutate: (doc: Json) => void): Json {
  const doc = example(name);
  mutate(doc);
  return doc;
}

/** Schema paths (instancePath plus keyword) of every error, for a reason check. */
function reasons(doc: unknown): string[] {
  return validateBundleMetadata(doc).map(
    (e) => `${e.instancePath} ${e.keyword}`
  );
}

const REFERENCED = "referenced-audioTranslation.json";
const CUSTOM = "custom-x-tcMobileAudio.json";

describe("the gate is green on every legitimate state", () => {
  it.each([
    [
      "the referenced-book worked example (scripture / audioTranslation)",
      REFERENCED,
    ],
    [
      "the any-other-book worked example (parascriptural / x-tcMobileAudio)",
      CUSTOM,
    ],
    ["the spec's own audioTranslation example", "spec-audioTranslation.json"],
  ])("accepts %s", (_label, file) => {
    expect(validateBundleMetadata(example(file))).toEqual([]);
  });

  it("accepts all rights reserved written as shortStatements, with no licenses", () => {
    const doc = mutated(REFERENCED, (d) => {
      delete d.copyright.licenses;
      d.copyright.shortStatements = [
        { statement: "All rights reserved.", lang: "en" },
      ];
    });
    expect(validateBundleMetadata(doc)).toEqual([]);
  });
});

describe("the gate is red, each for its named reason", () => {
  it("refuses a scripture bundle with an empty currentScope", () => {
    const doc = mutated(REFERENCED, (d) => {
      d.type.flavorType.currentScope = {};
    });
    expect(reasons(doc)).toContain(
      "/type/flavorType/currentScope minProperties"
    );
  });

  it("refuses a currentScope keyed OBS (not a USFM book code)", () => {
    const doc = mutated(REFERENCED, (d) => {
      d.type.flavorType.currentScope = { OBS: ["1:1-8"] };
    });
    expect(validateBundleMetadata(doc).length).toBeGreaterThan(0);
    expect(reasons(doc)).toContain(
      "/type/flavorType/currentScope propertyNames"
    );
  });

  it("refuses shortStatements and licenses together", () => {
    const doc = mutated(REFERENCED, (d) => {
      d.copyright.shortStatements = [
        { statement: "All rights reserved.", lang: "en" },
      ];
    });
    expect(reasons(doc)).toContain("/copyright oneOf");
  });

  it("refuses a meta.version other than the pinned one", () => {
    expect(PINNED_BUNDLE_SCHEMA_VERSION).toBe("1.0.0");
    const doc = mutated(REFERENCED, (d) => {
      d.meta.version = "2.0.0";
    });
    expect(reasons(doc)).toContain("/meta/version enum");
  });

  it.each([
    ["uppercase hex", "D32E9EFA2F1AF2064E513C807D606421"],
    ["31 characters", "d32e9efa2f1af2064e513c807d60642"],
    ["33 characters", "d32e9efa2f1af2064e513c807d6064211"],
    ["not hex", "z32e9efa2f1af2064e513c807d606421"],
  ])("refuses an md5 that is %s", (_label, md5) => {
    const doc = mutated(REFERENCED, (d) => {
      d.ingredients["ingredients/audio/c001/s001.mp3"].checksum.md5 = md5;
    });
    expect(reasons(doc)).toContain(
      "/ingredients/ingredients~1audio~1c001~1s001.mp3/checksum/md5 pattern"
    );
  });

  it("refuses an ingredient with no md5 under checksum", () => {
    const doc = mutated(REFERENCED, (d) => {
      d.ingredients["ingredients/audio/c001/s001.mp3"].checksum = {};
    });
    expect(validateBundleMetadata(doc).length).toBeGreaterThan(0);
  });

  it("refuses a scripture bundle with no languages (a profile rule: v1.0.0 itself never requires it)", () => {
    const doc = mutated(REFERENCED, (d) => {
      delete d.languages;
    });
    expect(reasons(doc)).toEqual(["/languages profile"]);
  });

  it("does not demand languages of a non-scripture flavour", () => {
    const doc = mutated(CUSTOM, (d) => {
      delete d.languages;
    });
    expect(validateBundleMetadata(doc)).toEqual([]);
  });

  it("refuses a document that is not a Scripture Burrito at all", () => {
    expect(validateBundleMetadata({}).length).toBeGreaterThan(0);
    expect(validateBundleMetadata(null).length).toBeGreaterThan(0);
  });
});

describe("the loader", () => {
  it("repairs a trailing comma before a closing bracket", () => {
    expect(parseSchemaJson('{"a": [1, 2,], "b": {"c": 3,},}')).toEqual({
      a: [1, 2],
      b: { c: 3 },
    });
  });

  it("leaves a comma-bracket inside a string alone", () => {
    expect(parseSchemaJson('{"a": ",]", "b": [1,],}')).toEqual({
      a: ",]",
      b: [1],
    });
  });
});
