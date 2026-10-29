import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDistGate } from "./dist-gate";

/**
 * The tester-only phone check stays out of the entry chunk (#1747).
 *
 * `App` loads `PhoneCheckScreen` with `React.lazy`, so the screen, its hook,
 * the probes and the report builder are fetched only when a tester opens the
 * check. A static import of any of them from the entry graph pulls them all
 * back into the chunk every launch parses. Which chunk a module lands in is a
 * fact about the build, not the source, so this reads `dist/`.
 *
 * Each marker is a string literal that only one phone-check module holds: two
 * element ids from `components/phone-check-screen.tsx`, and the throwaway
 * database name and both `sessionStorage` keys from
 * `hooks/phone-check-probes.ts`. The run slot `App` reads at launch
 * (`hooks/phone-check-run-slot.ts`) holds none of them and is meant to stay.
 *
 * Needs a build: it runs under `npm run test:dist` and skips elsewhere (see
 * `./dist-gate`). A green result is a statement about the last build.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const ASSETS_DIR = path.join(DIST, "assets");
const INDEX_HTML = path.join(DIST, "index.html");

const present = existsSync(INDEX_HTML) && existsSync(ASSETS_DIR);
const GATE = resolveDistGate(present, "dist/index.html and dist/assets/*.js");

const MARKERS = [
  "phone-check-title",
  "phone-check-memory-warning",
  "tc-mobile-phone-check",
  "tc-mobile:phone-check:allocation",
  "tc-mobile:phone-check:results",
] as const;

/** The one module script `index.html` loads: the entry chunk's file name. */
function entryChunk(): string {
  const html = readFileSync(INDEX_HTML, "utf8");
  const entries = [
    ...html.matchAll(
      /<script\b[^>]*\btype="module"[^>]*\bsrc="\/assets\/([^"]+\.js)"/g
    ),
  ].map((m) => m[1]!);
  expect(entries).toHaveLength(1);
  return entries[0]!;
}

describe.skipIf(GATE === "skip")(
  "the phone check's chunk (dist/, requires `npm run build`)",
  () => {
    const scripts =
      GATE === "skip"
        ? []
        : readdirSync(ASSETS_DIR)
            .filter((name) => name.endsWith(".js"))
            .map((name) => ({
              name,
              text: readFileSync(path.join(ASSETS_DIR, name), "utf8"),
            }));

    it("is not in the entry chunk", () => {
      const entry = entryChunk();
      const text = scripts.find((s) => s.name === entry)?.text;
      // A floor: an entry this test cannot read would pass every check below.
      expect(text?.length ?? 0).toBeGreaterThan(0);
      expect(MARKERS.filter((m) => text!.includes(m))).toEqual([]);
    });

    it("is in the build, in a chunk other than the entry", () => {
      // The other half: a marker renamed out of the source would leave the
      // check above passing over nothing.
      const entry = entryChunk();
      const missing = MARKERS.filter(
        (m) => !scripts.some((s) => s.name !== entry && s.text.includes(m))
      );
      expect(missing).toEqual([]);
    });
  }
);
