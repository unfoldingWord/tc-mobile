/**
 * Fetching OBS reference media onto the device.
 *
 * Network I/O lives here rather than in `lib/` so the core stays pure and
 * testable. The Door43 CDN serves `Access-Control-Allow-Origin: *` on both
 * artwork and narration (verified 2026-08-22), so these can be fetched
 * directly into IndexedDB with no proxy and no Worker.
 */

import { getMedia, hasMedia, putMedia } from "@/lib/storage/media";
import type { ObsStory } from "@/types/obs";

/** Narration for a whole story, at the smallest of the three published bitrates. */
export function narrationUrl(story: number, quality = "32kbps"): string {
  const id = String(story).padStart(2, "0");
  return `https://cdn.door43.org/en/obs/v6/${quality}/en_obs_${id}_${quality}.mp3`;
}

async function fetchInto(url: string): Promise<void> {
  if (await hasMedia(url)) return;
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  await putMedia(url, await res.blob());
}

/**
 * @pivot-pending The OBS media cache has no production caller and B0 (#26)
 * removes its last one, `narrationUrl`. Open question Q4 keeps artwork in the
 * model and the cache; whether "kept" means kept with zero callers is the
 * decision recorded in #26 before B0 starts. Do not delete on knip's word.
 */
export interface DownloadProgress {
  readonly done: number;
  readonly total: number;
}

/**
 * Download one story's FULL-SIZE artwork (and optionally its narration).
 *
 * Thumbnails are bundled with the app, so the section list never needs this —
 * it works offline on first run. This covers only the 360px frames shown in
 * the recording view, where the translator is actually looking at the picture,
 * and the narration MP3 used as reference audio.
 *
 * Individual frame failures do not abort the download — a story that is
 * fifteen-sixteenths available is far more useful in a workshop than none of
 * it. The count of failures is returned so the UI can be honest about it.
 *
 * @pivot-pending No caller. See the note on `DownloadProgress` — this is the
 * media cache whose fate #26 settles.
 */
export async function downloadStoryMedia(
  story: ObsStory,
  options: {
    includeNarration?: boolean;
    onProgress?: (p: DownloadProgress) => void;
    signal?: AbortSignal;
  } = {}
): Promise<{ downloaded: number; failed: string[] }> {
  const urls = story.frames.map((f) => f.image);
  if (options.includeNarration) urls.push(narrationUrl(story.story));

  const failed: string[] = [];
  let done = 0;

  for (const url of urls) {
    if (options.signal?.aborted) break;
    try {
      await fetchInto(url);
    } catch {
      failed.push(url);
    }
    done++;
    options.onProgress?.({ done, total: urls.length });
  }

  return { downloaded: done - failed.length, failed };
}

/** How much of a story is already on the device, for a per-story indicator. */
/**
 * @pivot-pending The OBS media cache has no production caller and B0 (#26)
 * removes its last one, `narrationUrl`. Open question Q4 keeps artwork in the
 * model and the cache; whether "kept" means kept with zero callers is the
 * decision recorded in #26 before B0 starts. Do not delete on knip's word.
 */
export async function storyMediaStatus(
  story: ObsStory
): Promise<{ cached: number; total: number }> {
  const flags = await Promise.all(story.frames.map((f) => hasMedia(f.image)));
  return {
    cached: flags.filter(Boolean).length,
    total: story.frames.length,
  };
}

/**
 * An object URL for a cached frame image, or `null` when it is not downloaded.
 *
 * Callers must revoke the URL when done; leaking these on a fifty-row list is
 * a real memory problem on a low-end device.
 */
/**
 * @pivot-pending The OBS media cache has no production caller and B0 (#26)
 * removes its last one, `narrationUrl`. Open question Q4 keeps artwork in the
 * model and the cache; whether "kept" means kept with zero callers is the
 * decision recorded in #26 before B0 starts. Do not delete on knip's word.
 */
export async function cachedImageObjectUrl(
  url: string
): Promise<string | null> {
  const entry = await getMedia(url);
  return entry ? URL.createObjectURL(entry.blob) : null;
}
