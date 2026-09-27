import { strings } from "@/lib/strings";
import type { TakeCapStatus } from "@/lib/audio/take-cap";

/**
 * The take-length warning (#1005, "Warn at 15, seal at 20"): from 15:00 of a
 * live take, the recorder's own elapsed-time readout is the marker — this
 * renders the remaining-minutes word that rides inside it, nothing else.
 *
 * **State-in-place, not a message bubble** (AGENTS.md: this UI is for people
 * who may not read; no text toast). The recorder-status cluster this mounts
 * inside of already tints to the warn role via `data-near-limit` on the
 * container (`recorder.tsx`, `3-components.css`), which is the actual
 * "marker" a translator sees — a colour change on a control already on
 * screen, not a new element competing for attention. This component only
 * supplies the number, because a colour alone does not say how much time is
 * left, and a colour is invisible to a screen reader.
 *
 * **No new chatty announcement.** The container this mounts inside already
 * carries `role="status"`, so screen readers already hear it re-announced as
 * the ticking timer's text changes underneath it (that behaviour predates
 * this component and is unchanged here). Rounding to whole minutes
 * (`Math.floor`, clamped to at least 1) means THIS span's own text changes
 * once a minute rather than every tick, so it does not add a second
 * re-announcement cadence on top of the one the timer already has. Floor,
 * not ceil: a warning never claims more whole minutes than are left. The
 * clamp means the last minute (and the cap itself) reads "1 min left" rather
 * than "0", a deliberate tradeoff, not a claim that a full minute remains.
 *
 * **Not an O4 workbench state.** `docs/design/o4-design-system.md`'s screen
 * map (09 Recording) names no near-limit variant, and #1005 scoped drawing
 * this marker as separate UI work after the O4 Recorder lane, without
 * settling its look. This is a proposal for the requirements owner, not a
 * spec the workbench already signed off — see the PR body.
 *
 * Lifted out of `recorder.tsx` the way `RecorderStatus` and `RecorderStamp`
 * were (#197/#945): this module is pure props in, markup out, so
 * `tests/take-cap-marker.test.ts` can render it with `tests/render.ts` and
 * read what it produced without mocking the recorder's hook graph.
 *
 * Takes only `takeCap`, not a separate `recording` flag. `takeCapStatus`
 * (`lib/audio/take-cap.ts`) already answers "is this a live take" itself —
 * `nearLimit` is false at idle, while requesting, while processing, and once
 * a take is recorded/playing, because it freezes `elapsedMs` at its last
 * value rather than resetting it. A second `recording` gate here would only
 * ever agree with what `nearLimit` already says (both read the same recorder
 * `state` at the same moment in `recorder.tsx`), which is exactly the
 * equivalent-mutant shape #1076's own docblock names and removed rather than
 * shipped.
 */
export function TakeCapMarker({
  takeCap,
}: {
  readonly takeCap: TakeCapStatus;
}) {
  if (!takeCap.nearLimit) return null;
  const minutesLeft = Math.max(1, Math.floor(takeCap.remainingMs / 60_000));
  return (
    <span className="recorder-take-warn" data-testid="take-cap-marker">
      {strings.takeCapWarning(minutesLeft)}
    </span>
  );
}
