import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * #923, round 2: `android-play.yml` still shipped every Google Play `.aab`
 * with the WEB build's Workbox precache worker — the exact defect round 1's
 * fix closed in `android-apk.yml` and `ios-testflight.yml` but missed here,
 * because nothing enforced the invariant across every native lane, only
 * fixed three known instances of it by hand. This is the class-level gate:
 * any workflow that syncs a `dist/` into a native project (`npx cap sync`)
 * must have that `dist/` produced by the NATIVE build mode
 * (`npm run build:native`, or `npm run test:dist:native`, which runs it
 * internally — see `scripts/test-dist-native.mjs`), not a plain
 * `npm run build`, or the native shell inherits a service worker that never
 * belongs inside it (`vite.config.ts`'s native-mode comment has the full
 * reasoning).
 *
 * The check reads REAL command lines only — lines whose trimmed text does
 * not start with `#` — never prose. A workflow's own explanatory comments
 * (this repo's convention: full bash-comment lines, never mixed into a
 * command line) are excluded on purpose: matching raw file text would treat
 * a sentence like "not the plain `npm run build`" as a real invocation and
 * report a false failure. `npx cap sync` (not bare `cap sync`) is what's
 * matched for the same reason — this repo's real invocations are always
 * `npx cap sync <platform>`, while an `echo "::error::cap sync did not
 * copy…"` string is not a command.
 */

const WORKFLOWS_DIR = path.resolve(import.meta.dirname, "../.github/workflows");

const BUILD_NATIVE = /\bnpm run (?:build:native|test:dist:native)\b/;
const BUILD_BARE = /\bnpm run build\b(?!:)/;
const CAP_SYNC = /\bnpx cap sync\b/;

/**
 * Real (non-comment) command lines, in file order.
 *
 * "Non-comment" is a trimmed-line check, not a full shell/YAML parser: this
 * repo's convention is that an explanatory comment is always its own whole
 * line (`# …`), and every workflow line asserted against below follows that
 * convention — see the two probes in the synthetic test block for what this
 * does and does not catch.
 */
function commandLines(text: string): string[] {
  return text.split("\n").filter((line) => !line.trim().startsWith("#"));
}

/**
 * Whether every `npx cap sync` in `text` is fed by a native-mode build —
 * the most recently seen build command before it, in file order, must be
 * `build:native`/`test:dist:native`, not a bare `npm run build`, and not
 * nothing at all (a `cap sync` with no preceding build command is also a
 * failure: there is no evidence the synced dist/ is native).
 */
export function everySyncFollowsNativeBuild(text: string): {
  ok: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  let lastBuildWasNative: boolean | null = null;

  for (const line of commandLines(text)) {
    if (BUILD_NATIVE.test(line)) {
      lastBuildWasNative = true;
    } else if (BUILD_BARE.test(line)) {
      lastBuildWasNative = false;
    } else if (CAP_SYNC.test(line)) {
      if (lastBuildWasNative !== true) {
        failures.push(line.trim());
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

describe("everySyncFollowsNativeBuild (synthetic fixtures)", () => {
  it("passes when build:native precedes cap sync", () => {
    const fixture = [
      "      - run: npm run build",
      "      - run: npm run test:dist:native",
      "      - run: npx cap sync android",
    ].join("\n");
    expect(everySyncFollowsNativeBuild(fixture)).toEqual({
      ok: true,
      failures: [],
    });
  });

  it("fails when a bare npm run build is the last build before cap sync", () => {
    // The exact android-play.yml shape before this PR's round-2 fix.
    const fixture = [
      "      - run: npm run build",
      "      - run: npx cap sync android",
    ].join("\n");
    const result = everySyncFollowsNativeBuild(fixture);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(["- run: npx cap sync android"]);
  });

  it("fails when cap sync has no preceding build command at all", () => {
    const fixture = "      - run: npx cap sync android";
    expect(everySyncFollowsNativeBuild(fixture).ok).toBe(false);
  });

  it("does not count a comment line mentioning 'npm run build' as a real command", () => {
    // The exact trap this file's own prose could fall into if it matched raw
    // text instead of non-comment lines — see this test file's own header,
    // and vite.config.ts / docs/native/README.md's prose.
    const fixture = [
      "      # not the plain npm run build here",
      "      - run: npm run build:native",
      "      - run: npx cap sync android",
    ].join("\n");
    expect(everySyncFollowsNativeBuild(fixture).ok).toBe(true);
  });

  it("treats a later bare npm run build as re-poisoning a prior native build", () => {
    // Order matters: a native build followed by a LATER bare rebuild before
    // sync must still fail — the most RECENT build wins, not merely "any
    // native build somewhere earlier in the file".
    const fixture = [
      "      - run: npm run build:native",
      "      - run: npm run build",
      "      - run: npx cap sync android",
    ].join("\n");
    expect(everySyncFollowsNativeBuild(fixture).ok).toBe(false);
  });
});

describe("every real native-shipping workflow (.github/workflows/*.yml)", () => {
  const files = readdirSync(WORKFLOWS_DIR).filter(
    (f) => f.endsWith(".yml") || f.endsWith(".yaml")
  );
  // Sanity floor: this suite is worthless if the directory listing came back
  // empty (a moved/renamed workflows dir would silently pass with 0 cases).
  it("found at least the three known native lanes", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files)("%s: every npx cap sync is fed by a native build", (file) => {
    const text = readFileSync(path.join(WORKFLOWS_DIR, file), "utf8");
    const result = everySyncFollowsNativeBuild(text);
    expect(
      result.ok,
      `${file}: npx cap sync not preceded by a native build (#923):\n${result.failures.join("\n")}`
    ).toBe(true);
  });
});
