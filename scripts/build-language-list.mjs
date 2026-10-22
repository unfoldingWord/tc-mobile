#!/usr/bin/env node
/**
 * Build the bundled language list the Export project language ask searches
 * (#1492, ADR 0017).
 *
 * Reads SIL's langtags.json at ONE pinned release and keeps three things per
 * language: the BCP 47 tag, the English name and the autonym where langtags
 * has one. Everything else (regions, scripts, alternate names, Windows tags)
 * is dropped, which is what keeps the file small enough to bundle.
 *
 * langtags is MIT (© SIL International); its names and autonyms come from
 * Ethnologue. ADR 0017 records the licence reading and the DRI's decision.
 *
 *   node scripts/build-language-list.mjs              # download the pinned release
 *   node scripts/build-language-list.mjs <langtags.json>  # use a local copy
 *
 * Either way the input must match the pinned SHA-256, so the committed list
 * can only come from the release named below. Moving to a newer release is
 * a change to both constants, in its own PR.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LANGTAGS_VERSION = "26242.1446";
const LANGTAGS_SHA256 =
  "b4976f2cb0d000a4c1671e72c41c71d0530f9be36092831566330d76db52d57f";
const LANGTAGS_URL = `https://github.com/silnrsi/langtags/releases/download/${LANGTAGS_VERSION}/langtags.json`;
const OUT = path.resolve(import.meta.dirname, "../src/data/language-list.json");

/**
 * The sort key: lower case, accents and leading punctuation removed, so
 * "’Auhelawa" files under A rather than ahead of every letter.
 */
function sortKey(text) {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .toLowerCase();
}

function clean(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

/**
 * langtags rows -> `{ source, languages }`, each language `[tag, name]` or
 * `[tag, name, autonym]`, ordered by folded English name, then tag.
 *
 * Kept: every row whose tag does not start with `_` (langtags' own
 * bookkeeping rows), is not `obsolete`, and has a name. The autonym is
 * `localname`, else `localnames[0]` (doc/langtags.md: "If not present, use
 * localnames[0]"), dropped when it is the English name again.
 */
export function buildLanguageList(rows, version = LANGTAGS_VERSION) {
  const seen = new Set();
  const languages = [];
  for (const row of rows) {
    const tag = clean(row?.tag);
    const name = clean(row?.name);
    if (tag === "" || tag.startsWith("_") || row.obsolete || name === "") {
      continue;
    }
    if (seen.has(tag)) throw new Error(`langtags repeats the tag ${tag}`);
    seen.add(tag);
    const autonym = clean(row.localname) || clean(row.localnames?.[0]);
    languages.push(
      autonym === "" || autonym === name ? [tag, name] : [tag, name, autonym]
    );
  }
  languages.sort((a, b) => {
    const byName = sortKey(a[1]).localeCompare(sortKey(b[1]), "en");
    if (byName !== 0) return byName;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  return { source: `SIL langtags ${version}`, languages };
}

/** One language per line, so a release bump reads as a diff of languages. */
export function serialiseLanguageList(list) {
  const rows = list.languages.map((l) => JSON.stringify(l)).join(",\n");
  return `{"source":${JSON.stringify(list.source)},"languages":[\n${rows}\n]}\n`;
}

async function readPinned(localPath) {
  let bytes;
  if (localPath) {
    bytes = await readFile(localPath);
  } else {
    const response = await fetch(LANGTAGS_URL);
    if (!response.ok) {
      throw new Error(`${LANGTAGS_URL}: HTTP ${response.status}`);
    }
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== LANGTAGS_SHA256) {
    throw new Error(
      `langtags.json is not release ${LANGTAGS_VERSION}: sha256 ${sha}`
    );
  }
  return JSON.parse(bytes.toString("utf8"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const list = buildLanguageList(await readPinned(process.argv[2]));
  await writeFile(OUT, serialiseLanguageList(list));
  console.log(`${list.source}: ${list.languages.length} languages -> ${OUT}`);
}
