/**
 * Access to the bundled OBS catalogue.
 *
 * The catalogue is ~230 KB of JSON. It is loaded via dynamic `import()` so it
 * does not sit in the entry chunk: a translator who opens their own recordings
 * should not pay for story metadata they are not using. The service worker
 * still precaches the chunk, so it is available offline on first run.
 */

import type { ObsCatalog, ObsStory } from "@/types/obs";

let cached: ObsCatalog | null = null;

export async function loadCatalog(): Promise<ObsCatalog> {
  cached ??= (await import("@/data/obs-catalog.json")).default as ObsCatalog;
  return cached;
}

export async function getStory(n: number): Promise<ObsStory | undefined> {
  const catalog = await loadCatalog();
  return catalog.stories.find((s) => s.story === n);
}

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

export const OBS_BOOK_CODE = "OBS";
