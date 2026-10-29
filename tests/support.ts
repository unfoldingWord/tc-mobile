import postcss, { type AtRule, type ChildNode } from "postcss";
import { vi } from "vitest";

import { createMp3StreamEncoder, encodeMp3 } from "@/lib/audio/mp3";
import {
  MP3_GRANULE,
  MP3_TOTAL_DELAY,
  mp3GranuleCount,
} from "@/lib/audio/mp3-align";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { buildClipMeta, newClipId } from "@/lib/storage/clips";
import { closeDb, getDb } from "@/lib/storage/db";
import { saveTake, type CommitResult } from "@/lib/storage/takes";
import type { UseEraseSegment } from "@/hooks/use-erase-segment";
import type { AudioCodec, Clip, Mp3Stream } from "@/types/audio";
import type { ClipId, SegmentId, Take } from "@/types/domain";

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
    // The same synchronous encoder, fed in pieces (#1003 part b).
    openMp3Stream: vi.fn(async (): Promise<Mp3Stream> => {
      const stream = createMp3StreamEncoder();
      return {
        write: async (samples) => stream.write(samples),
        finish: async () => stream.finish(),
        cancel: () => {},
      };
    }),
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
 * A resting `UseEraseSegment` — never erasing, for a suite that must mount a
 * screen or menu taking `erase` as a prop but never exercises erase itself.
 * Since #160 (L-12) lifted the one hook instance up to `App`, both entry
 * points take `erase` as a real prop, not a module import — so a `vi.mock`
 * of `@/hooks/use-erase-segment` intercepts nothing there and silently tests
 * the wrong thing (the #631 hazard). This stays a real value a caller passes
 * in, and is annotated `UseEraseSegment` so a shape change to the hook's
 * return fails every call site at `tsc`, not silently (#856 item 3).
 *
 * A fresh object per call, not a shared singleton: each suite still gets its
 * own `vi.fn()` identity, matching the one-per-module-scope shape these sites
 * had before extraction, and no suite can observe another's mock calls.
 */
export function restingErase(): UseEraseSegment {
  return {
    erase: vi.fn(async () => "ok" as const),
    erasing: false,
    isErasing: () => false,
  };
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
 * Record a take for a segment through the app's own commit write, `saveTake`.
 *
 * The setup a suite needs when it only wants "this segment is recorded": a
 * fresh clip id (or the one passed, to build a shared or retried clip), `frames`
 * constant samples at the canonical rate, and the clip and take written in ONE
 * transaction exactly as the recorder's save does. There is deliberately no
 * store write that points a segment at a clip without writing the clip: a take
 * naming absent audio is damage, and a suite that wants it deletes the clip
 * after this returns (#159 S-13).
 */
/**
 * The take an ordinary commit wrote; throws when it wrote none (a discarded or
 * already-saved take, v13 #38), so a setup that expected a save fails loudly.
 */
export function savedTake(result: CommitResult): Take {
  if (result.outcome !== "saved") {
    throw new Error(`Expected a saved take, got ${result.outcome}`);
  }
  return result.take;
}

export async function recordTake(
  segmentId: SegmentId,
  opts: {
    clipId?: ClipId;
    frames?: number;
    finished?: boolean;
    now?: number;
  } = {}
): Promise<Take> {
  const { clipId = newClipId(), frames = 100, ...take } = opts;
  return savedTake(
    await saveTake(
      segmentId,
      clipId,
      new Int16Array(frames).fill(1000),
      CANONICAL_SAMPLE_RATE,
      take
    )
  );
}

/**
 * Drop a clip's disposition record (v13, #38), so a case can hand a SECOND take
 * the same clip id through `saveTake`. The app never does: a clip id is minted
 * once per take, and the record keyed by it is what refuses a second save. The
 * shared-clip cases pin a defensive store invariant, so they build the sharing
 * themselves, here.
 */
export async function forgetDisposition(clipId: ClipId): Promise<void> {
  await (await getDb()).delete("takeDispositions", clipId);
}

/**
 * Lose a clip's metadata and bytes from under the take that names it: the
 * damaged state the resolvers report. Not a write path (`deleteClip` keeps a
 * clip a take still names, v13 #38), so it is done on the stores directly.
 */
export async function loseClip(clipId: ClipId): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["clipMeta", "clipData"], "readwrite");
  await Promise.all([
    tx.objectStore("clipMeta").delete(clipId),
    tx.objectStore("clipData").delete(clipId),
    tx.done,
  ]);
}

/**
 * Store a PCM clip that no take references — a damaged state, not a write path.
 *
 * No code in `src/` writes a clip on its own: `saveTake` writes the clip and
 * its take in one transaction (#38), so an unreferenced clip is reachable only
 * as damage or as a race a suite sets up on purpose (a stale take row's audio,
 * a clip re-stored under an id its segment no longer names, the bytes a failed
 * attempt is assumed to have left). It is also how a suite restores bytes under an
 * id a take STILL names (the resolver's re-store case in `storage.test.ts`), so
 * "no take references it" holds for the helper's contract, not for every caller;
 * do not rewrite that test into a real orphan. This builds that state directly, the way
 * other suites write a bare `takes` row. The meta comes from `buildClipMeta`,
 * the same builder `saveTake` uses. A property of the clip write itself belongs
 * on `saveTake` (`recordTake` above), never here (#1365).
 */
export async function storeOrphanClip(
  clipId: ClipId,
  samples: Int16Array
): Promise<void> {
  const meta = buildClipMeta(clipId, samples, CANONICAL_SAMPLE_RATE);
  const db = await getDb();
  const tx = db.transaction(["clipMeta", "clipData"], "readwrite");
  await Promise.all([
    tx.objectStore("clipMeta").put(meta),
    tx.objectStore("clipData").put(new Int16Array(samples).buffer, clipId),
    tx.done,
  ]);
}

/**
 * Make every transaction this connection opens from now on throw `error` the
 * moment its caller asks it for `storeName`, until `vi.restoreAllMocks()`.
 *
 * The seam is the native `IDBDatabase.transaction` (pass `unwrap(await
 * getDb())`), reached past idb's proxy, because the storage writes do not
 * return their transaction and the stores they ask for are the only thing
 * observable from outside. A throw, not a failed request: it is the case
 * IndexedDB does NOT abort on its own, so it is what proves a write's own
 * abort guard. Shared by the delete suites and the v12 write-path suite.
 */
export function throwWhenStoreRequested(
  raw: IDBDatabase,
  storeName: string,
  error: Error
) {
  const open = raw.transaction.bind(raw);
  return vi
    .spyOn(raw, "transaction")
    .mockImplementation((...args: Parameters<IDBDatabase["transaction"]>) => {
      const tx = open(...args);
      const objectStore = tx.objectStore.bind(tx);
      Object.defineProperty(tx, "objectStore", {
        configurable: true,
        value: (name: string) => {
          if (name === storeName) throw error;
          return objectStore(name);
        },
      });
      return tx;
    });
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

/** `stripComments`' two patterns, but each comment is overwritten with spaces
 *  (its newlines kept) instead of removed, so every index and line number in
 *  the result is the same as in `text`. For a sweep that reports `file:line`
 *  from a match (#822). Same string-blindness as `stripComments`; a sweep
 *  whose file set is open-ended reads through `blankCodeComments` instead. */
export function blankComments(text: string): string {
  const blank = (comment: string) => comment.replace(/[^\n]/g, " ");
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/.*$/gm, blank);
}

/**
 * `blankComments` for the Gradle (Groovy) and Swift files the native-licence
 * pins read (#822): `//` and `/* *\/` comments are overwritten with spaces,
 * their newlines kept, so a line-anchored pattern still sees every line start.
 * Unlike `stripComments` and `blankComments`, it steps over `"…"` and `'…'`
 * literals, so the `//` in a `"https://…"` URL stays code.
 *
 * It throws instead of guessing on the forms it does not model: a
 * triple-quoted or `#"` raw literal, a literal that runs past its line, a
 * block comment that opens another (Swift nests them, Groovy does not), and an
 * unterminated block comment. A source that grows one fails its suite loudly.
 */
export function blankGradleSwiftComments(source: string): string {
  const blank = (comment: string) => comment.replace(/[^\n]/g, " ");
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '"' || c === "'") {
      if (source.startsWith(c.repeat(3), i))
        throw new Error(`triple-quoted literal at offset ${i}`);
      let j = i + 1;
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\n")
          throw new Error(`literal at offset ${i} runs past its line`);
        j += source[j] === "\\" ? 2 : 1;
      }
      if (j >= source.length)
        throw new Error(`unterminated literal at offset ${i}`);
      out += source.slice(i, j + 1);
      i = j + 1;
    } else if (c === "#" && next === '"') {
      throw new Error(`raw literal at offset ${i}`);
    } else if (c === "/" && next === "/") {
      const newline = source.indexOf("\n", i);
      const end = newline === -1 ? source.length : newline;
      out += blank(source.slice(i, end));
      i = end;
    } else if (c === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      if (close === -1)
        throw new Error(`unterminated block comment at offset ${i}`);
      const comment = source.slice(i, close + 2);
      if (comment.indexOf("/*", 2) !== -1)
        throw new Error(`nested block comment at offset ${i}`);
      out += blank(comment);
      i = close + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Strips YAML `#` comments: a `#` at the start of a line or after a space or
 *  tab, to the end of that line, as YAML itself reads one (#822). Not
 *  quote-aware, so a ` #` inside a quoted string or a `run:` script also cuts
 *  the rest of that line. Callers check that no line they assert on holds one. */
export function stripYamlComments(yaml: string): string {
  return yaml.replace(/(^|[ \t])#.*$/gm, "$1");
}

/** Strips HTML `<!-- ... -->` comments, so a commented-out element cannot be
 *  the first match a source pin reads from an `.html` file (#822). */
export function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
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

/** Strips CSS block comments — and ONLY block comments. CSS has no `//`
 *  comment, and `stripComments`' line strip would eat the rest of a line
 *  holding a `url(https://…)`, closing brace included. */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
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
  const stripped = stripCssComments(css);
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

/**
 * The value of the ONE `property` declaration in a rule `body` (what `cssRule`
 * returns), trimmed. A bare `/color:\s*X/` over a body is satisfied by
 * `background-color: X` or `border-color: X`, and by the first of two
 * declarations when a later one in the same rule overrides it (#533's
 * 2026-09-22 notes, 1 and 4). This anchors the
 * property on a declaration boundary, and throws when it is absent or declared
 * more than once, so a caller can assert the value with `toBe` rather than a
 * pattern. Quoted strings and `url(…)` are blanked to same-length filler
 * before the scan, so a `;` or `color:` inside `content: "…"` or a data URI
 * is not read as a declaration; the value is sliced from the unmasked text.
 * Still a scanner, not a tokenizer: a comment splitting an identifier
 * (`col/* *\/or`) is glued back together by the strip.
 */
export function declarationValue(body: string, property: string): string {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const text = stripCssComments(body);
  const masked = text.replace(
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\burl\([^)]*\)/g,
    (m) => m[0] + "_".repeat(m.length - 2) + m.at(-1)!
  );
  const values = [
    ...masked.matchAll(
      new RegExp(
        `(?<=^|[;{])\\s*${escaped}\\s*:\\s*([^;{}]*?)\\s*(?=;|}|$)`,
        "dg"
      )
    ),
  ].map((m) => text.slice(...m.indices![1]!));
  if (values.length > 1) {
    throw new Error(
      `declarationValue: ${property} declared ${values.length} times`
    );
  }
  const value = values.at(0);
  if (value === undefined || value === "") {
    throw new Error(`declarationValue: no ${property} declaration`);
  }
  return value;
}

/**
 * One spelling for an at-rule prelude, so a source `@media (a: b)` and the
 * minified `@media (a:b)` compare equal: whitespace collapsed, and dropped
 * around `:` and `,` and just inside parentheses. The space between the
 * at-rule's name and its first `(` is kept.
 */
function normalizePrelude(prelude: string): string {
  return prelude
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*([:,])\s*/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
}

function atRulePrelude(node: AtRule): string {
  return normalizePrelude(
    node.params === "" ? `@${node.name}` : `@${node.name} ${node.params}`
  );
}

/** An at-rule with a block (`@media … { }`), as opposed to `@import …;`. */
function isBlockAtRule(node: ChildNode): node is AtRule {
  return node.type === "atrule" && node.nodes !== undefined;
}

/**
 * The text of ONE nested at-rule block, found by its path of preludes from
 * the top of the stylesheet — `["@layer components", "@media
 * (prefers-reduced-motion: reduce)"]` is the reduced-motion block directly
 * inside the one components layer (#954). Read the result with `cssRule` and
 * `declarationValue` as usual.
 *
 * `cssRule` alone matches a rule at any depth, so a selector restyled inside
 * a reduced-motion block reads as ambiguous, and the only way to the rule
 * inside the block was to slice the file at the block's first `@media` by
 * hand — which silently reads the wrong block once a second one is added
 * ahead of it. This throws instead:
 *
 *   - when a prelude has no block at its level ("missing block"),
 *   - when it has more than one ("appears N times"), and
 *   - when the block holds no style rule of its own ("empty block").
 *
 * Comments are stripped before the search, so a commented-out block never
 * matches. Deeper at-rule blocks inside the one returned are left out, so a
 * rule nested below the scope is not read as the scope's own. Preludes are
 * matched exactly after whitespace is normalised; a prefix does not match.
 */
export function cssScope(css: string, preludes: readonly string[]): string {
  if (preludes.length === 0) throw new Error("cssScope: no preludes given");
  let scope: AtRule | undefined;
  let level: ChildNode[] = postcss.parse(stripCssComments(css)).nodes;
  for (const prelude of preludes) {
    const want = normalizePrelude(prelude);
    const hits = level.filter(
      (node): node is AtRule =>
        isBlockAtRule(node) && atRulePrelude(node) === want
    );
    if (hits.length === 0) throw new Error(`cssScope: missing block: ${want}`);
    if (hits.length > 1) {
      throw new Error(`cssScope: block appears ${hits.length} times: ${want}`);
    }
    scope = hits[0]!;
    level = scope.nodes ?? [];
  }
  const own = level.filter((node) => !isBlockAtRule(node));
  if (!own.some((node) => node.type === "rule")) {
    throw new Error(`cssScope: empty block: ${atRulePrelude(scope!)}`);
  }
  return own.map((node) => node.toString()).join("\n");
}

/** `[ids, classes-attributes-pseudo-classes, types-pseudo-elements]`. */
export type Specificity = readonly [number, number, number];

const ZERO: Specificity = [0, 0, 0];

/** The four pseudo-elements CSS 2 spelled with one colon. */
const LEGACY_PSEUDO_ELEMENTS = new Set([
  "before",
  "after",
  "first-line",
  "first-letter",
]);

/** Pseudo-classes whose weight is that of their most specific argument. */
const ARGUMENT_WEIGHTED = new Set(["is", "not", "has", "matches"]);

/** The index just past an identifier starting at `at`, escapes included. */
function identEnd(text: string, at: number): number {
  let i = at;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\\") {
      const hex = /^[0-9a-fA-F]{1,6}\s?/.exec(text.slice(i + 1));
      i += 1 + (hex ? hex[0].length : 1);
    } else if (/[\w-]/.test(ch) || ch.charCodeAt(0) > 0x7f) {
      i++;
    } else {
      break;
    }
  }
  return i;
}

/** The index of the bracket that closes the one opened at `open`. */
function closingIndex(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]" };
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\") {
      i++;
    } else if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (pairs[ch]) {
      stack.push(pairs[ch]);
    } else if (ch === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  throw new Error(`unbalanced selector: ${text}`);
}

/**
 * Splits `text` at the characters `isCut` accepts, but only at the top level:
 * never inside parentheses, brackets, a string or after a backslash.
 */
function topLevelCuts(text: string, isCut: (ch: string) => boolean): number[] {
  const cuts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\") i++;
    else if (ch === "(" || ch === "[") i = closingIndex(text, i);
    else if (ch === '"' || ch === "'") {
      const end = text.indexOf(ch, i + 1);
      i = end === -1 ? text.length : end;
    } else if (isCut(ch)) cuts.push(i);
  }
  return cuts;
}

function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let from = 0;
  for (const cut of [...topLevelCuts(list, (ch) => ch === ","), list.length]) {
    parts.push(list.slice(from, cut).trim());
    from = cut + 1;
  }
  return parts;
}

function addSpecificity(a: Specificity, b: Specificity): Specificity {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Positive when `a` outweighs `b`, negative when `b` does, 0 on a tie. */
export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The weight of the most specific selector in an argument list. A
 *  relative selector (`:has(> .a)`) is weighed without its combinator. */
function maxSpecificity(list: string): Specificity {
  return splitSelectorList(list)
    .map((part) => complexSpecificity(part.replace(/^[>+~]\s*/, "")))
    .reduce((max, s) => (compareSpecificity(s, max) > 0 ? s : max), ZERO);
}

function complexSpecificity(selector: string): Specificity {
  let total: Specificity = ZERO;
  let i = 0;
  while (i < selector.length) {
    const ch = selector[i]!;
    if (ch === "#") {
      total = addSpecificity(total, [1, 0, 0]);
      i = identEnd(selector, i + 1);
    } else if (ch === ".") {
      total = addSpecificity(total, [0, 1, 0]);
      i = identEnd(selector, i + 1);
    } else if (ch === "[") {
      total = addSpecificity(total, [0, 1, 0]);
      i = closingIndex(selector, i) + 1;
    } else if (ch === ":") {
      const element = selector[i + 1] === ":";
      const nameAt = i + (element ? 2 : 1);
      const nameEnd = identEnd(selector, nameAt);
      const name = selector.slice(nameAt, nameEnd).toLowerCase();
      let argument: string | null = null;
      i = nameEnd;
      if (selector[nameEnd] === "(") {
        const close = closingIndex(selector, nameEnd);
        argument = selector.slice(nameEnd + 1, close);
        i = close + 1;
      }
      if (element || LEGACY_PSEUDO_ELEMENTS.has(name)) {
        total = addSpecificity(total, [0, 0, 1]);
      } else if (name === "where") {
        // `:where()` weighs nothing, whatever it holds.
      } else if (ARGUMENT_WEIGHTED.has(name)) {
        total = addSpecificity(total, maxSpecificity(argument ?? ""));
      } else {
        total = addSpecificity(total, [0, 1, 0]);
        const of =
          (name === "nth-child" || name === "nth-last-child") && argument
            ? /\sof\s/.exec(argument)
            : null;
        if (of && argument) {
          const list = argument.slice(of.index + of[0].length);
          total = addSpecificity(total, maxSpecificity(list));
        }
      }
    } else if (/[a-zA-Z_-]/.test(ch) || ch.charCodeAt(0) > 0x7f) {
      // A type selector: letters reached here start a compound.
      total = addSpecificity(total, [0, 0, 1]);
      i = identEnd(selector, i);
    } else {
      // `*`, whitespace and combinators weigh nothing.
      i++;
    }
  }
  return total;
}

/**
 * The specificity of ONE selector, per Selectors Level 4 (#954): `:is()`,
 * `:not()` and `:has()` weigh as their most specific argument, `:where()`
 * weighs nothing, `:nth-child(… of S)` adds S's weight to its own, attribute
 * selectors weigh as a class, and pseudo-elements — the four legacy
 * one-colon spellings included — weigh as a type. Throws on a selector list,
 * which has no one specificity.
 *
 * Not handled, because nothing in this app's stylesheets uses them:
 * namespaces (`svg|a`), and the arguments of `::slotted()` and `:host()`.
 */
export function specificity(selector: string): Specificity {
  const parts = splitSelectorList(selector);
  if (parts.length !== 1) {
    throw new Error(
      `specificity: a selector list, not one selector: ${selector}`
    );
  }
  return complexSpecificity(parts[0]!);
}

function unescapeIdent(ident: string): string {
  return ident.replace(/\\([0-9a-fA-F]{1,6}\s?|[\s\S])/g, (_, esc: string) =>
    /^[0-9a-fA-F]/.test(esc) ? String.fromCodePoint(parseInt(esc, 16)) : esc
  );
}

/**
 * The subject of one selector — its right-most compound — reduced to what the
 * cascade gate compares (#954): the compound's own classes (unescaped; a class
 * inside `:has()` or `:not()` is not the subject's) and its pseudo-element,
 * if any (`"before"` for both `::before` and `:before`).
 */
export function subjectCompound(selector: string): {
  classes: string[];
  pseudoElement: string | null;
} {
  const text = selector.trim();
  const cuts = topLevelCuts(text, (ch) => /[\s>+~]/.test(ch));
  const compound = text.slice((cuts.at(-1) ?? -1) + 1);
  const classes: string[] = [];
  let pseudoElement: string | null = null;
  let i = 0;
  while (i < compound.length) {
    const ch = compound[i]!;
    if (ch === "\\") {
      i += 2;
    } else if (ch === "(" || ch === "[") {
      i = closingIndex(compound, i) + 1;
    } else if (ch === ".") {
      const end = identEnd(compound, i + 1);
      classes.push(unescapeIdent(compound.slice(i + 1, end)));
      i = end;
    } else if (ch === ":") {
      const element = compound[i + 1] === ":";
      const nameAt = i + (element ? 2 : 1);
      const end = identEnd(compound, nameAt);
      const name = compound.slice(nameAt, end).toLowerCase();
      if (element || LEGACY_PSEUDO_ELEMENTS.has(name)) pseudoElement = name;
      i = end;
    } else {
      i++;
    }
  }
  return { classes, pseudoElement };
}

/**
 * One spelling for a selector, so a source selector and the minifier's form
 * of it compare equal (#954): whitespace collapsed, dropped around `>`, `+`,
 * `~` and `,` and just inside parentheses; the legacy pseudo-elements spelled
 * with one colon; and an attribute value quoted only when it is not an
 * identifier. Strings are left as they are otherwise. A comparison key, not a
 * selector to hand back to CSS.
 */
export function normalizeSelector(selector: string): string {
  const strings: string[] = [];
  const masked = selector.replace(
    /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g,
    (_, dq?: string, sq?: string) => {
      strings.push(dq ?? sq ?? "");
      return `\u0000${strings.length - 1}\u0000`;
    }
  );
  return masked
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*([>+~,])\s*/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/::(before|after|first-line|first-letter)\b/gi, ":$1")
    .replace(/\u0000(\d+)\u0000/g, (_, n: string) => {
      const value = strings[Number(n)]!;
      return /^-?[_a-zA-Z][\w-]*$/.test(value) ? value : `"${value}"`;
    });
}

/** One declaration of a `BuiltCssRule`. */
interface CssDeclaration {
  property: string;
  value: string;
  important: boolean;
}

/** One selector of one style rule, as `builtCssRules` lists it. */
export interface BuiltCssRule {
  /** The rule's position among the stylesheet's style rules; the selectors
   *  of one rule share it. */
  order: number;
  selector: string;
  /** The at-rule preludes around the rule, outermost first, spelled as
   *  `cssScope` matches them. */
  context: string[];
  declarations: CssDeclaration[];
}

/**
 * Every style rule in a stylesheet — the built `dist/assets/*.css` is the one
 * it is for, but any CSS parses — one entry per selector, in source order,
 * with the at-rule context it sits in (#954). Keyframe selectors (`0%`, `to`)
 * are not style rules and are left out. Parsed with PostCSS, so strings,
 * `url()` and nested at-rules cannot break it the way a brace count would.
 * Throws when the stylesheet has no style rules, and on a nested style rule
 * (CSS nesting), which the minifier this app uses never emits and the cascade
 * gate cannot weigh.
 */
export function builtCssRules(css: string): BuiltCssRule[] {
  const out: BuiltCssRule[] = [];
  let order = 0;
  postcss.parse(css).walkRules((rule) => {
    const context: string[] = [];
    let inKeyframes = false;
    for (let up = rule.parent; up && up.type !== "root"; up = up.parent) {
      if (up.type === "rule") {
        throw new Error(`builtCssRules: nested style rule: ${rule.selector}`);
      }
      const at = up as AtRule;
      if (/keyframes$/i.test(at.name)) inKeyframes = true;
      context.unshift(atRulePrelude(at));
    }
    if (inKeyframes) return;
    const declarations = rule.nodes
      .filter((node) => node.type === "decl")
      .map((decl) => ({
        property: decl.prop,
        value: decl.value,
        important: Boolean(decl.important),
      }));
    for (const selector of rule.selectors) {
      out.push({ order, selector, context: [...context], declarations });
    }
    order++;
  });
  if (out.length === 0) throw new Error("builtCssRules: no style rules");
  return out;
}

/**
 * A shared chapter file's audio: the bytes after its one leading ID3v2 tag
 * (#252). Throws when the file has no tag, or when the audio after it opens
 * with a second one, so a suite comparing audio also pins "exactly one tag".
 */
export function audioAfterId3v2(file: Uint8Array): Uint8Array {
  const isTag = (at: number) =>
    file[at] === 0x49 && file[at + 1] === 0x44 && file[at + 2] === 0x33;
  if (!isTag(0)) throw new Error("audioAfterId3v2: no ID3v2 tag");
  const size = (file[6]! << 21) | (file[7]! << 14) | (file[8]! << 7) | file[9]!;
  const end = 10 + size;
  if (isTag(end)) throw new Error("audioAfterId3v2: a second ID3v2 tag");
  return file.subarray(end);
}
