/**
 * Timing provider registry.
 *
 * The one place the app asks "is there frame timing for this chapter?".
 * Providers are tried in registration order and the first non-null answer
 * wins, so a locally-authored file can override a published one.
 *
 * Today nothing is registered by default and every call returns `null` — see
 * `src/types/timing.ts` for why that is the honest state of the world. The
 * seam exists so that turning timing on is one registration, not a refactor.
 */

import { validateFrameTimings } from "./parse";
import type { ChapterTiming, TimingProvider, TimingRef } from "@/types/timing";

const providers: TimingProvider[] = [];

export function registerTimingProvider(provider: TimingProvider): void {
  if (providers.some((p) => p.id === provider.id)) {
    throw new Error(`Timing provider "${provider.id}" is already registered`);
  }
  providers.push(provider);
}

export function listTimingProviders(): readonly TimingProvider[] {
  return [...providers];
}

/** Test seam. The app never calls this. */
export function clearTimingProviders(): void {
  providers.length = 0;
}

export interface LoadTimingResult {
  readonly timing: ChapterTiming | null;
  /** Providers that threw. Surfaced so a broken source is visible, not silent. */
  readonly errors: readonly { providerId: string; message: string }[];
}

/**
 * Ask every provider, in order, for timing covering `ref`.
 *
 * A provider that throws does not abort the search — a malformed local file
 * must not prevent a good published one from being used — but the failure is
 * returned rather than swallowed.
 */
export async function loadChapterTiming(
  ref: TimingRef
): Promise<LoadTimingResult> {
  const errors: { providerId: string; message: string }[] = [];

  for (const provider of providers) {
    try {
      const timing = await provider.load(ref);
      if (!timing) continue;
      // Validate at the boundary: a provider is an outside source, and
      // overlapping spans produce a confidently-wrong playhead.
      validateFrameTimings(timing.frames);
      return { timing, errors };
    } catch (cause) {
      errors.push({
        providerId: provider.id,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return { timing: null, errors };
}

/** The frame sounding at `positionMs`, or null outside every span. */
export function frameAt(
  timing: ChapterTiming,
  positionMs: number
): number | null {
  for (const f of timing.frames) {
    if (positionMs >= f.startMs && positionMs < f.endMs) return f.frame;
  }
  return null;
}

/** Where a frame's reference audio starts, or null when it is not covered. */
export function frameStart(
  timing: ChapterTiming,
  frame: number
): FrameSpan | null {
  const f = timing.frames.find((x) => x.frame === frame);
  return f ? { startMs: f.startMs, endMs: f.endMs } : null;
}

export interface FrameSpan {
  readonly startMs: number;
  readonly endMs: number;
}
