import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The main thread must never import the LGPL encoder (#1167 review, Frank
 * P2 — `finish-transcode.ts` importing `lib/audio/mp3.ts`, which statically
 * imports `Mp3Encoder` from `@breezystack/lamejs`, risked putting that
 * encoder back in the main bundle against ADR 0009 §1). `lib/audio/mp3.ts`
 * stays the encoder's only home; `lib/audio/mp3-size.ts` holds the pure size
 * arithmetic a main-thread caller needs and carries no lamejs import, so
 * `hooks/finish-transcode.ts` (loaded from `App.tsx`, not the worker) reaches
 * only that.
 *
 * A source-level check, not a bundler check: it is a property of what the
 * files import, true regardless of what a future Rollup version does with
 * dead-code elimination — the property `dist-css.test.ts`'s sibling for JS
 * (a built-bundle grep) would only catch AFTER the fact. Matches the IMPORT
 * declaration only, never a bare word: `mp3-size.ts`'s own docblock names
 * lamejs and `Mp3Encoder` in prose, to explain why it exists.
 */

const REPO = join(import.meta.dirname, "..");

function readSrc(path: string): string {
  return readFileSync(join(REPO, "src", path), "utf8");
}

describe("finish-transcode.ts never reaches lamejs (#1167)", () => {
  it("does not import lib/audio/mp3 (the encoder-carrying module)", () => {
    const source = readSrc("hooks/finish-transcode.ts");
    expect(source).not.toMatch(/from ["']@\/lib\/audio\/mp3["']/);
  });

  it("imports its bitrate/size helpers from lib/audio/mp3-size instead", () => {
    const source = readSrc("hooks/finish-transcode.ts");
    expect(source).toMatch(/from ["']@\/lib\/audio\/mp3-size["']/);
  });
});

describe("lib/audio/mp3-size.ts carries no lamejs import (#1167)", () => {
  it("does not import @breezystack/lamejs", () => {
    // Matches the IMPORT declaration, not the bare word — this module's own
    // docblock names lamejs and `Mp3Encoder` in prose, correctly, to explain
    // why it exists and why the size estimate is approximate. A prose mention
    // is not a bundle risk; an import binding is.
    const source = readSrc("lib/audio/mp3-size.ts");
    expect(source).not.toMatch(/from ["']@breezystack\/lamejs["']/);
    expect(source).not.toMatch(/require\(["']@breezystack\/lamejs["']\)/);
  });
});
