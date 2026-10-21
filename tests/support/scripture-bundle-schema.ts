import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { Ajv, type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

/**
 * The Scripture Bundle metadata gate (#1478): compiles the vendored, pinned
 * schema set once and answers whether a `metadata.json` meets it. Test-only;
 * no validator ships to phones. Which version is pinned, and why, is
 * `tests/fixtures/scripture-bundle/README.md` and ADR 0014 point 1.
 */

/** The spec version the gate checks. Moving it is a reviewed change. */
export const PINNED_BUNDLE_SCHEMA_VERSION = "1.0.0";

const FIXTURES = path.resolve(
  import.meta.dirname,
  "../fixtures/scripture-bundle"
);
const SCHEMA_DIR = path.join(
  FIXTURES,
  `schema-${PINNED_BUNDLE_SCHEMA_VERSION}`
);

const METADATA_SCHEMA_ID = "https://burrito.bible/schema/metadata.schema.json";

/**
 * Upstream's `scripture_flavor_type.schema.json` has trailing commas and is
 * not JSON. The vendored file stays byte-for-byte as fetched; this drops a
 * comma that directly precedes a closing bracket, outside string literals.
 */
export function parseSchemaJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Falls through to the repair below; a second failure throws.
  }
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch !== "," || !/^\s*[}\]]/.test(text.slice(i + 1))) {
      out += ch;
    }
  }
  return JSON.parse(out);
}

function schemaFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return schemaFiles(full);
    return entry.name.endsWith(".json") ? [full] : [];
  });
}

function compile() {
  // ajv 8 honours keywords beside `$ref`. Not strict: the spec requires properties inside if/then that it does not declare there (strictRequired).
  const ajv = new Ajv({ strict: false });
  // Annotation keywords the spec's schemas carry (its validate.js declares the same).
  ajv.addKeyword("$$target");
  ajv.addKeyword("revision");
  ajv.addKeyword("timestamp");
  addFormats(ajv);
  for (const file of schemaFiles(SCHEMA_DIR)) {
    ajv.addSchema(parseSchemaJson(readFileSync(file, "utf8")) as object);
  }
  const validate = ajv.getSchema(METADATA_SCHEMA_ID);
  if (!validate)
    throw new Error(`schema ${METADATA_SCHEMA_ID} not found in ${SCHEMA_DIR}`);
  return validate;
}

let compiled: ReturnType<typeof compile> | undefined;

/**
 * One rule of our own beside the schema (ADR 0014, "What the spec is"): the
 * pinned v1.0.0 schema compares an object to a string enum in its `languages`
 * condition, so it never requires `languages`; the 2.0.0 draft does, and the
 * profile writes `languages` always.
 */
function profileErrors(json: unknown): ErrorObject[] {
  const doc = json as {
    type?: { flavorType?: { name?: unknown } };
    languages?: unknown;
  } | null;
  if (doc?.type?.flavorType?.name !== "scripture") return [];
  if (Array.isArray(doc.languages) && doc.languages.length > 0) return [];
  return [
    {
      instancePath: "/languages",
      schemaPath: "#/profile/languages",
      keyword: "profile",
      params: {},
      message: "a scripture bundle must carry a non-empty languages array",
    },
  ];
}

/** Errors for a metadata document; an empty array means it meets the schema and our profile. */
export function validateBundleMetadata(json: unknown): ErrorObject[] {
  compiled ??= compile();
  const schemaErrors = compiled(json) ? [] : [...(compiled.errors ?? [])];
  return [...schemaErrors, ...profileErrors(json)];
}
