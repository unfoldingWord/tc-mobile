import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDistGate } from "./dist-gate";

/**
 * The loudness DSP ships in the MP3 worker chunk and nowhere else (#1747).
 *
 * `LoudnessMeter`, `LoudnessNormalizer`, `normalizePcm` and
 * `normalizationGainDb` (`lib/audio/loudness.ts`), and the phone check's
 * `runDspBench` (`lib/phone-check/dsp-bench.ts`) that drives them, are
 * reached from `hooks/mp3.worker.ts`. Main-thread code may import the
 * module's constants (`NO_STAGES_RUN`, `LOUDNESS_TARGET`), and tree-shaking
 * keeps the classes out of the main-thread chunks. One static import of a
 * class from a main-thread module would put the whole chain in the entry
 * chunk, and nothing else would notice.
 *
 * The markers are error strings that only the DSP code holds. String
 * literals survive minification where identifiers do not. Each marker is
 * asserted present in the worker as well as absent elsewhere, so a reworded
 * message fails here instead of making the absence check vacuous.
 *
 * Needs a build: it runs under `npm run test:dist` and skips elsewhere (see
 * `./dist-gate`). A green result is a statement about the last build.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const ASSETS_DIR = path.join(DIST_DIR, "assets");
const INDEX_HTML = path.join(DIST_DIR, "index.html");

const scripts = existsSync(ASSETS_DIR)
  ? readdirSync(ASSETS_DIR)
      .filter((name) => name.endsWith(".js"))
      .map((name) => ({
        name,
        text: readFileSync(path.join(ASSETS_DIR, name), "utf8"),
      }))
  : [];

const GATE = resolveDistGate(
  scripts.length > 0 && existsSync(INDEX_HTML),
  "dist/assets/*.js and dist/index.html"
);

/** One per DSP piece: the meter, the shared chunk check, the normalizer and
 *  the whole-take normalizer. */
const DSP_MARKERS = [
  "LoudnessMeter: already finished",
  "chunk holds a non-finite sample",
  "LoudnessNormalizer: empty flush buffer",
  "normalizePcm: wrote",
] as const;

const WORKER_CHUNK = /^mp3\.worker-[\w-]+\.js$/;

function workerChunk(): (typeof scripts)[number] {
  const found = scripts.filter((s) => WORKER_CHUNK.test(s.name));
  expect(found.map((s) => s.name)).toHaveLength(1);
  return found[0] as (typeof scripts)[number];
}

/** The entry chunk, as `index.html` names it. */
function entryChunk(): (typeof scripts)[number] {
  const html = readFileSync(INDEX_HTML, "utf8");
  const sources = [
    ...html.matchAll(
      /<script\b[^>]*\btype="module"[^>]*\bsrc="\/assets\/([^"]+\.js)"/g
    ),
  ].map((m) => m[1]);
  expect(sources).toHaveLength(1);
  const entry = scripts.find((s) => s.name === sources[0]);
  if (entry === undefined) throw new Error(`no chunk named ${sources[0]}`);
  return entry;
}

describe.skipIf(GATE === "skip")(
  "loudness DSP in the build (dist/assets/*.js, requires `npm run build`)",
  () => {
    it("the worker chunk holds every DSP marker", () => {
      const worker = workerChunk();
      // Names the missing markers, not the whole minified chunk.
      expect(DSP_MARKERS.filter((m) => !worker.text.includes(m))).toEqual([]);
    });

    it("the entry chunk holds no DSP marker", () => {
      const entry = entryChunk();
      expect(WORKER_CHUNK.test(entry.name)).toBe(false);
      // Names the leaked markers, not the whole minified chunk.
      expect(DSP_MARKERS.filter((m) => entry.text.includes(m))).toEqual([]);
    });

    it("no chunk other than the worker holds a DSP marker", () => {
      const worker = workerChunk();
      const others = scripts.filter((s) => s !== worker);
      // A floor, so an empty list cannot pass.
      expect(others.length).toBeGreaterThan(0);
      const leaks = others.flatMap((s) =>
        DSP_MARKERS.filter((m) => s.text.includes(m)).map(
          (m) => `${s.name}: ${m}`
        )
      );
      expect(leaks).toEqual([]);
    });
  }
);
