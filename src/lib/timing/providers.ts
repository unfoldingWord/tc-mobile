/**
 * Ready-made providers. None is registered by default.
 *
 * When unfoldingWord publishes OBS timing, turning it on is:
 *
 *   registerTimingProvider(webVttProvider({
 *     id: "uw-obs-vtt",
 *     audioUrl: (ref) => narrationUrl(ref.chapter),
 *     vttUrl: (ref) => `https://.../en_obs_${pad(ref.chapter)}.vtt`,
 *   }));
 */

import { parseBurritoAlignment, parseWebVtt } from "./parse";
import type { ChapterTiming, TimingProvider, TimingRef } from "@/types/timing";

interface RemoteProviderOptions {
  readonly id: string;
  readonly describe?: string;
  /** Return the URL for this reference, or null when unsupported. */
  readonly url: (ref: TimingRef) => string | null;
  readonly audioUrl: (ref: TimingRef) => string;
  readonly fetchImpl?: typeof fetch;
}

/** WebVTT whose cue identifiers are frame numbers. */
export function webVttProvider(options: RemoteProviderOptions): TimingProvider {
  return remoteProvider(options, "text", (body, ref, audioUrl) => ({
    ref,
    audioUrl,
    frames: parseWebVtt(body as string),
    providerId: options.id,
  }));
}

/** Scripture Burrito alignment, `type: "audio-reference"`. */
export function burritoTimingProvider(
  options: RemoteProviderOptions
): TimingProvider {
  return remoteProvider(options, "json", (body, ref, audioUrl) => ({
    ref,
    audioUrl,
    frames: parseBurritoAlignment(body),
    providerId: options.id,
  }));
}

function remoteProvider(
  options: RemoteProviderOptions,
  as: "text" | "json",
  build: (body: unknown, ref: TimingRef, audioUrl: string) => ChapterTiming
): TimingProvider {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    id: options.id,
    describe: options.describe ?? `remote ${as} timing (${options.id})`,
    async load(ref) {
      const url = options.url(ref);
      if (!url) return null;

      const res = await doFetch(url);
      // 404 means "this provider has nothing here", which is not a fault.
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText} for ${url}`);
      }

      const body = as === "json" ? await res.json() : await res.text();
      const timing = build(body, ref, options.audioUrl(ref));
      // Zero frames is "nothing here", not a broken file.
      return timing.frames.length > 0 ? timing : null;
    },
  };
}

/** Timing supplied in memory — used by tests, and by a future local editor. */
export function staticTimingProvider(
  id: string,
  table: readonly ChapterTiming[]
): TimingProvider {
  return {
    id,
    describe: `in-memory timing (${table.length} chapters)`,
    load: (ref) =>
      Promise.resolve(
        table.find(
          (t) => t.ref.book === ref.book && t.ref.chapter === ref.chapter
        ) ?? null
      ),
  };
}
