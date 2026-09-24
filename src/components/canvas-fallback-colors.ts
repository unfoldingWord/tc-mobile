/**
 * Canvas fallback colours (#506 item 1, George R5 P3-1).
 *
 * `waveform.tsx` and `live-scope.tsx` each read a themed CSS custom property
 * with `getComputedStyle(...).getPropertyValue(...)` and fall back to a
 * literal hex only when that read comes back empty — a token that failed to
 * resolve, not the normal path.
 *
 * These fallbacks are UNTHEMED: fixed dark-theme hex values, not a live token
 * read, so they never track a theme switch. Under `data-theme="light"` a
 * missed token would still paint one of these dark-theme colours on a light
 * floor — that gap is unresolved; George's read named two ways to close it
 * (keep the fallback dark-only and name it as such, or drop it and let a
 * missed token paint nothing), and the choice is left to #506, not decided
 * here. Nothing here claims the fallback is ever actually reached on a
 * device — it is a defensive floor for a read that should not fail, not a
 * verified path.
 *
 * `waveform.tsx` and `live-scope.tsx` both fell back to the same voice/amber
 * value before this file existed; it is named once here so the two constants
 * cannot drift apart from each other.
 */

/** The audio/voice accent. Shared by `waveform.tsx` and `live-scope.tsx`. */
export const CANVAS_FALLBACK_VOICE = "#e6a444";

/** The "no audio yet" faint tone. `waveform.tsx` only. */
export const CANVAS_FALLBACK_FAINT = "#5f6b7a";

/** The live record-head tone. `live-scope.tsx` only. */
export const CANVAS_FALLBACK_LIVE = "#d84a4a";

/**
 * `value.trim() || fallback` as a named call, so every canvas fallback read
 * goes through the one place that decides "empty" (an empty string, or one
 * that is only whitespace) rather than each call site re-deriving it.
 */
export function withCanvasFallback(value: string, fallback: string): string {
  return value.trim() || fallback;
}
