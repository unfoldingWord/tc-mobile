import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SHIPPED_LOCALE } from "@/lib/locale";
import { resolveDistGate } from "./dist-gate";

/**
 * The locale actually reaches the two artifacts a phone reads (#169).
 *
 * `tests/locale.test.ts` covers the transform as a table and greps
 * `vite.config.ts` for the wiring, but a grep over build config is precisely
 * the half-gate AGENTS.md warns about: `localeHtmlPlugin` can be defined,
 * spelled correctly, and never registered in the `plugins` array — the source
 * reads right and `dist/index.html` ships unlabelled. Only the emitted files
 * can say otherwise, so this reads them.
 *
 * `dir` is the reason this is worth a build-artifact suite rather than trust.
 * A wrong `lang` is a subtle defect; a missing `dir` on a right-to-left build
 * lays the entire UI out backwards, and it is invisible to everyone developing
 * in English — the shipped locale today is `ltr`, so every assertion here
 * would also pass on a build that dropped the attribute entirely. That is why
 * the checks below assert the ATTRIBUTE IS PRESENT with the locale's value,
 * never merely that the document looks correct.
 *
 * Runs under `npm run test:dist` after a build; skipped by a bare `npm test`.
 * See `tests/dist-gate.ts` for why presence of `dist/` decides nothing.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const HTML = path.join(ROOT, "dist", "index.html");
const MANIFEST = path.join(ROOT, "dist", "manifest.webmanifest");

const gate = resolveDistGate(
  existsSync(HTML) && existsSync(MANIFEST),
  "dist/index.html or dist/manifest.webmanifest"
);

describe.skipIf(gate === "skip")(
  "the built app is labelled with its locale",
  () => {
    it("dist/index.html carries the locale's lang AND dir", () => {
      const html = readFileSync(HTML, "utf8");
      const tag = /<html\b([^>]*)>/i.exec(html)?.[1];

      expect(tag, "no <html> tag in the built document").toBeTruthy();
      expect(tag).toMatch(new RegExp(`\\slang="${SHIPPED_LOCALE.tag}"`));
      expect(tag).toMatch(new RegExp(`\\sdir="${SHIPPED_LOCALE.dir}"`));
    });

    it("the built manifest carries the same two, and the same values", () => {
      const manifest: unknown = JSON.parse(readFileSync(MANIFEST, "utf8"));
      expect(manifest).toMatchObject({
        lang: SHIPPED_LOCALE.tag,
        dir: SHIPPED_LOCALE.dir,
      });
    });

    it("the document and the manifest agree", () => {
      // Two files, one fact. They were two independent literals before #169, and
      // this is the assertion that would have caught them drifting apart.
      const html = readFileSync(HTML, "utf8");
      const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
        lang?: string;
        dir?: string;
      };
      const tag = /<html\b([^>]*)>/i.exec(html)?.[1] ?? "";

      expect(tag).toContain(`lang="${manifest.lang}"`);
      expect(tag).toContain(`dir="${manifest.dir}"`);
    });
  }
);
