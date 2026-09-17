/**
 * Pure layout-arithmetic helpers for the recorder sheet — split out of
 * `recorder.tsx` so the logic itself, not just its DOM-probing call site, is
 * observable by a plain Node test (George R4 P3, #414 round 5).
 *
 * Free of DOM by construction: nothing here reads `document` or `window`.
 * The probe that actually touches the DOM stays in `recorder.tsx`; this file
 * only resolves the string that probe measures.
 */

/**
 * Resolve a `getComputedStyle(...).height` string to a pixel number, or fall
 * back to `fallback` when the read did not resolve to a genuinely positive
 * length.
 *
 * `parseFloat` alone is not enough: an UNRESOLVED custom property (a
 * `var()`/`calc()` chain the browser could not compute) does not produce
 * `NaN` here — the property's used value falls back to its initial value,
 * `auto`, and an empty, absolutely-positioned probe element's used height
 * from `auto` is `"0px"`, which `parseFloat` happily reads as `0`. A bare
 * `Number.isFinite` guard treats that as a SUCCESSFUL read of zero, not the
 * resolution failure `fallback` exists to catch — silently reintroducing the
 * ~50px group growth (and the overflow-onto-Cut risk, #428) the caller's
 * shrink exists to prevent.
 */
export function resolveProbedPx(raw: string, fallback: number): number {
  const px = parseFloat(raw);
  return Number.isFinite(px) && px > 0 ? px : fallback;
}
