/**
 * Access to the bundled OBS catalogue.
 *
 * The catalogue is ~230 KB of JSON. It is loaded via dynamic `import()` so it
 * does not sit in the entry chunk: a translator who opens their own recordings
 * should not pay for story metadata they are not using. The service worker
 * still precaches the chunk, so it is available offline on first run.
 */

import type { Template } from "@/lib/storage/templates";
import type { ObsCatalog, ObsStory } from "@/types/obs";

let cached: ObsCatalog | null = null;

async function loadCatalog(): Promise<ObsCatalog> {
  cached ??= (await import("@/data/obs-catalog.json")).default as ObsCatalog;
  return cached;
}

/**
 * @pivotpending No caller yet. #253's `obsTemplate` (below) only needs each
 * story's frame COUNT to build a chapter's segments, which `listStories`
 * already gives it — so this stays unwired until something needs a frame's
 * `image`/`text` (the Recorder view showing OBS artwork while recording an
 * OBS-derived segment), which is #246's UI half, not this storage lane's.
 */
export async function getStory(n: number): Promise<ObsStory | undefined> {
  const catalog = await loadCatalog();
  return catalog.stories.find((s) => s.story === n);
}

/**
 * The available stories, cheap to list (no frame text/artwork). The
 * Template Library picker's read (#246); also what `obsTemplate` maps over.
 */
export async function listStories(): Promise<
  readonly { story: number; title: string; frameCount: number }[]
> {
  const catalog = await loadCatalog();
  return catalog.stories.map((s) => ({
    story: s.story,
    title: s.title,
    frameCount: s.frames.length,
  }));
}

/**
 * The "Open Bible Stories" template: one Book, one Chapter per story, one
 * Segment per frame — referenced via `obsFrameScope` so an OBS-derived book
 * addresses its content the same way the catalogue itself does. Structure
 * *and* content (Q2's other half of the union): the reference is real data
 * the catalogue supplies, not a placeholder the translator fills in.
 *
 * Async because the catalogue is a dynamic `import()` (see module header);
 * the returned `Template`'s `chapters()` is itself synchronous — the
 * catalogue is fully resolved before this returns, per the `Template`
 * contract (`lib/storage/templates.ts`).
 *
 * `catalogVersion` stamps `catalog.generatedFrom` (the vendored snapshot's
 * source ref, e.g. "en_obs master") onto `Book.provenance` — the CC BY-SA
 * attribution trail ADR 0006 requires (#15), and the reason `createBookFromTemplate`
 * counts a repeated import against `source` rather than the title string: two
 * catalogue versions imported later would be distinguishable provenance, not
 * a naming collision.
 *
 * @pivotpending No caller yet — #246 (Template Library UI) is the picker
 * that calls this and hands the result to `createBookFromTemplate`. This
 * lane (#253, part of #33) builds only the storage/lib half.
 */
export async function obsTemplate(): Promise<Template> {
  const catalog = await loadCatalog();
  // Sequential, not `Promise.all`: `loadCatalog` above has already resolved
  // and cached the module by the time this runs, so `listStories`'s own
  // `loadCatalog` call returns the cached value immediately rather than
  // racing a second dynamic `import()` of the same chunk.
  const stories = await listStories();
  return {
    id: "obs",
    title: "Open Bible Stories",
    source: { kind: "obs", catalogVersion: catalog.generatedFrom },
    chapters: () =>
      stories.map((story) => ({
        number: story.story,
        segments: Array.from({ length: story.frameCount }, (_, i) => ({
          reference: {
            book: OBS_BOOK_CODE,
            scope: obsFrameScope(story.story, i + 1),
          },
        })),
      })),
  };
}

/**
 * The scope string identifying one OBS frame, in Scripture Burrito grammar.
 *
 * OBS is addressed as book "OBS" with story-as-chapter and frame-as-verse, so
 * story 1 frame 7 is `"1:7"`. This keeps OBS sections in the same addressing
 * scheme as scripture sections (`src/lib/scripture/scope.ts`) rather than
 * inventing a second one.
 *
 * Note the standard does not define an audio flavour for stories — see
 * docs/research/prior-art.md §4. This addressing is internally consistent and
 * burrito-shaped, but exporting OBS audio as a valid burrito remains unsolved.

 */
export function obsFrameScope(story: number, frame: number): string {
  return `${story}:${frame}`;
}

/**
 * Path to a frame's bundled thumbnail.
 *
 * Thumbnails ship with the app (598 frames, 2.5 MB total) rather than being
 * downloaded: the CDN publishes 360px, the list renders at 48–56px, and
 * centre-cropped to 128px the whole set is small enough to bundle. That removes
 * per-story artwork downloading from the primary path entirely.
 *
 * They ship in the build but are currently **excluded from the service-worker
 * precache** (#177): this function has no caller yet, so no screen draws the
 * thumbnails and precaching them only delayed offline-readiness. When a screen
 * reads this (the Template Library, #33), `jpg` is restored to
 * `workbox.globPatterns` in `vite.config.ts` so the set is precached for
 * offline first-run again — see ADR 0006 (2026-09-04 amendment) and
 * `tests/precache-manifest.test.ts`.
 *
 * Generated by `scripts/build-obs-thumbs.mjs`.

 */
export function thumbUrl(story: number, frame: number): string {
  const s = String(story).padStart(2, "0");
  const f = String(frame).padStart(2, "0");
  return `/obs/thumbs/obs-${s}-${f}.jpg`;
}

export const OBS_BOOK_CODE = "OBS";
