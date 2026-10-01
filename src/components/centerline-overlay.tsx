import { CENTER_FRACTION, centerlineOverlayShown } from "./recorder-stage";

interface CenterlineOverlayProps {
  readonly mode: "record" | "edit";
  readonly selectionActive: boolean;
  readonly liveScope: boolean;
}

/**
 * The fixed centerline (#110/#316), a DOM element rather than a bar in the
 * canvas (#415). The canvas is what MOVES during playback, so a painted line
 * would travel with it — exactly the thing this line is defined by not doing
 * ("the waveform pans under a FIXED centerline; the line never travels").
 * Same shape as `PlayheadOverlay`: absolute, 2px, `z-[1]` so it paints over
 * the selection band, `pointer-events-none` so it never takes the stage's
 * pan. `translateX(-1px)` centres it on the fraction, which is what the
 * canvas' `round(cf * w) - 1` did.
 *
 * `centerlineOverlayShown` is the COMPLETE gate (#418, George round-1 /
 * Frank round-2 P2 on #513) — both the `liveScope` term (mounted on the
 * `Waveform` path only; `LiveScope` draws its own record head while
 * capturing) and the #418 selection exception live in that one tested
 * function.
 *
 * Extracted out of `recorder.tsx`'s JSX into its own component (#513, dev
 * lead's cap pick, issuecomment-5742347381) so ONE thing both calls the gate
 * and owns the element it gates. The prior shape — `recorder.tsx` calling
 * `centerlineOverlayShown(...)` inline as a JSX `&&` condition, then
 * rendering the `<div>` as that condition's child — let a source-shape test
 * pin the CALL's arguments (round 3's fix, Frank round-3 P2) without being
 * able to tell whether the call's boolean result actually controlled what
 * rendered (Frank round-4 P2: swap the child for an empty fragment, or move
 * the `<div>` outside the `&&`, and a text-only assertion on the call site
 * cannot see it). A component that takes the gate's own inputs, calls the
 * gate, and returns either the element or `null` closes that gap: a render
 * test (`renderToStaticMarkup`) now asserts the actual DOM output, not just
 * the source text of a call.
 */
export function CenterlineOverlay({
  mode,
  selectionActive,
  liveScope,
}: CenterlineOverlayProps) {
  if (!centerlineOverlayShown({ mode, selectionActive, liveScope })) {
    return null;
  }

  return (
    <div
      data-testid="centerline-overlay"
      aria-hidden="true"
      className="bg-live pointer-events-none absolute top-0 bottom-0 z-[1] w-[2px]"
      // `left` stays inline: it is computed from `CENTER_FRACTION`, a module
      // constant the stage's own arithmetic reads, so it is data rather than
      // a colour bypassing the component layer (#164 L-14).
      style={{
        left: `${CENTER_FRACTION * 100}%`,
        transform: "translateX(-1px)",
      }}
    />
  );
}
