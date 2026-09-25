import { vi } from "vitest";

import { encodeMp3 } from "@/lib/audio/mp3";
import {
  MP3_GRANULE,
  MP3_TOTAL_DELAY,
  mp3GranuleCount,
} from "@/lib/audio/mp3-align";
import { closeDb, getDb } from "@/lib/storage/db";
import type { AudioCodec, Clip } from "@/types/audio";

/**
 * Shared test plumbing for the storage and export suites.
 *
 * Nothing here is a fixture of product behaviour — it is the codec seam filled
 * in for Node and two small readers the suites would otherwise each re-declare.
 */

/**
 * An `AudioCodec` for Node: the real synchronous encoder behind the async seam
 * `lib/` takes (the browser runs it in a worker, B8), and a decoder the test
 * supplies — or one that REFUSES, so a suite that never expects an MP3 clip fails
 * loudly if one is decoded rather than silently getting zeros. Both are `vi.fn`s
 * so a test can assert the encode was (not) reached or what the decoder was fed.
 */
export function testCodec(
  decodeMp3: AudioCodec["decodeMp3"] = () =>
    Promise.reject(new Error("no MP3 clip was expected in this test"))
) {
  return {
    encodeMp3: vi.fn(async (samples: Int16Array) => encodeMp3(samples)),
    decodeMp3: vi.fn(decodeMp3),
  };
}

/** A PCM clip's samples, failing the test if the clip is absent or MP3. */
export function samplesOf(clip: Clip | undefined): Int16Array {
  if (!clip) throw new Error("expected a stored clip, found none");
  if (clip.encoding !== "pcm")
    throw new Error(`expected a PCM clip, got ${clip.encoding}`);
  return clip.samples;
}

/**
 * Reset the database between cases by clearing every object store.
 *
 * Not `deleteDatabase`: that blocks indefinitely while any connection is open,
 * and a harness that resolves on `onblocked` silently carries the previous
 * test's data forward — which is exactly the flake this replaced. Clearing is
 * deterministic and needs no connection juggling. (AGENTS.md, Testing.)
 */
export async function clearAllStores(): Promise<void> {
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
}

/**
 * A ramp of `n` samples, 1..n scaled into the Int16 range, offset by `base`.
 * Never constant, so a fit that keeps the wrong end of a buffer is caught —
 * the fixture shape round 2 of PR #136 asked for.
 */
export function ramp(n: number, base = 0): Int16Array {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = base + 1 + (i % 30_000);
  return out;
}

/**
 * What a decoder that returns every granule hands back for `mp3`, the encode
 * of `pcm`: 1105 samples of priming, the recording, then granule padding to the
 * stream's emitted length. This is a synthetic layout, without codec noise.
 */
export function noTrimDecode(pcm: Int16Array, mp3: Uint8Array): Int16Array {
  const out = new Int16Array(mp3GranuleCount(mp3) * MP3_GRANULE);
  out.set(pcm, MP3_TOTAL_DELAY);
  return out;
}

/**
 * #533's extraction primitive family — the read-only source/text audits
 * (`*.test.ts` source-pin suites, the CSS bridge tests) each re-declared
 * `stripComments` (14 copies) and `matchingBraceClose` (10 copies), and four
 * `indexOf`/`lastIndexOf`-then-slice call sites had no floor on the anchor at
 * all: a missing or reordered anchor silently sliced an empty or wrong
 * region, and the assertion after it — often a `not.toMatch`/`not.toContain`
 * — passed trivially instead of catching anything (#533's audit, `b7004f8`).
 * Nine-plus hand-copies of the same discipline is exactly how four call sites
 * drifted without one; this file is the one place it is written down.
 */

/** Strips `/* ... *\/` and `// ...` comments. Not comment-in-string aware —
 *  callers that rely on it (see each source-pin suite) have checked by hand
 *  that the file they read holds no `//` or `/*` inside a string literal. */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Brace-counts from `openIndex` (the index of an opening `{`) to find its
 *  matching close, or -1. */
export function matchingBraceClose(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Slice out the `{ ... }` body that follows the first occurrence of
 *  `declaration` in `code`, throwing (not failing an assertion) when the
 *  anchor is gone — a renamed callback is a harness defect, not a finding. */
export function bodyAfter(code: string, declaration: string): string {
  const declStart = code.indexOf(declaration);
  if (declStart === -1) {
    throw new Error(`${declaration} not found — has it been renamed or moved?`);
  }
  const open = code.indexOf("{", declStart);
  if (open === -1) throw new Error(`${declaration}: opening brace not found`);
  const close = matchingBraceClose(code, open);
  if (close === -1 || close <= open) {
    throw new Error(`${declaration}: closing brace not found`);
  }
  return code.slice(open, close + 1);
}

/**
 * The index of `needle` in `text`, throwing when it is absent **or occurs more
 * than once**. `region` catches an anchor that went missing; it cannot catch
 * one that still matches, but matches the wrong occurrence — a second
 * `useLayoutEffect(() => {` added above the one a test names (#533, PR #531
 * round 7). A plain `indexOf` silently means "the first"; this makes the
 * test's assumption that there is only one fail at the moment it stops being
 * true, rather than when the extra occurrence happens to move to the front.
 */
export function uniqueIndexOf(text: string, needle: string): number {
  const at = text.indexOf(needle);
  if (at === -1) throw new Error(`uniqueIndexOf: not found: ${needle}`);
  if (text.indexOf(needle, at + 1) !== -1) {
    throw new Error(`uniqueIndexOf: occurs more than once: ${needle}`);
  }
  return at;
}

/**
 * Slices `text.slice(from, to)`, and turns three silent-pass shapes into a
 * throw instead of a trivially-satisfied assertion:
 *
 *   - a missing anchor — `from`/`to` still `-1` from whatever `indexOf` /
 *     `lastIndexOf` / `search` produced it, so `slice(-1, n)` cannot quietly
 *     become `""` and get regexed as if it were real content;
 *   - a degenerate or reversed span (`to <= from`) — an end anchor that
 *     resolved at or before the start, including the empty span `to === from`;
 *   - a span that resolves to nothing but whitespace, which a bare
 *     `expect(slice).not.toMatch(...)` cannot distinguish from real, checked
 *     content.
 *
 * `from`/`to` are indices the caller already computed by whatever means fits
 * the anchor (a forward `indexOf`, a `lastIndexOf` walking back from a later
 * point, a brace count) — `region` does not itself search text; it is the one
 * place the floor those searches all need gets checked, once.
 */
export function region(
  text: string,
  { from, to }: { from: number; to: number }
): string {
  if (from === -1) throw new Error("region: missing start anchor (-1)");
  if (to === -1) throw new Error("region: missing end anchor (-1)");
  if (to <= from) {
    throw new Error(`region: end (${to}) is not after start (${from})`);
  }
  const slice = text.slice(from, to);
  if (slice.trim() === "") {
    throw new Error("region: matched a region with no content");
  }
  return slice;
}

/**
 * Finds an exact, standalone CSS rule for `selector` and returns its
 * declaration body, trimmed. Strips CSS block comments first, so a comment
 * naming the selector in prose (#529's trap) can never be the match — block
 * comments only: CSS has no `//` comment, and `stripComments`' line strip
 * would eat the rest of a line holding a `url(https://…)`, closing brace
 * included. Throws — rather than returning `""` or `null` — when the rule is
 * absent, ambiguous or empty, so a caller cannot coerce a miss into an empty
 * string and regex nothing (#533's `notice-bridge` finding). A caller that
 * must assert a rule is deliberately ABSENT asserts the MISSING-rule throw
 * specifically (`toThrow(\`cssRule: missing rule: ${selector}\`)`); a bare
 * `toThrow()` would also accept an ambiguous or empty rule.
 */
export function cssRule(css: string, selector: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rules = [
    ...stripped.matchAll(new RegExp(`^\\s*${escaped}\\s*\\{([^{}]*)\\}`, "gm")),
  ];
  if (rules.length > 1) {
    throw new Error(
      `cssRule: ambiguous rule (${rules.length} matches): ${selector}`
    );
  }
  const body = rules.at(0)?.[1];
  if (body === undefined) throw new Error(`cssRule: missing rule: ${selector}`);
  const trimmed = body.trim();
  if (trimmed === "") throw new Error(`cssRule: empty rule: ${selector}`);
  return trimmed;
}
