import type { ShareError, ShareOutcome } from "./share-flow";

/**
 * The share progress timeline `useShareFlow` drives (#491): a busy modal held
 * for a MINIMUM time, then one outcome glyph held for a moment, then nothing.
 *
 * Why it exists. A share that succeeded on the Android APK looked exactly like
 * one the translator had dismissed: the sheet went away, the menu closed, and
 * nothing on screen said which had happened (#336's 2026-09-17 report — "maybe
 * I accidentally shared a test"). `send()` returned `"sent"` or `"dismissed"`
 * to its caller and set `idle` either way; only the return value knew. For a
 * person who may not read, the busy state was a line of text and the outcome
 * was absent.
 *
 * Why a machine and not two `setState`s. The issue asks for the minimum
 * display time to live in the hook, testable in Node — and a hold is a
 * property of TIME, which a hook with `setTimeout` in it cannot prove. So this
 * module takes `now` as data: every transition is a pure function of (state,
 * event), the hook's only job is to feed it `Date.now()` and to schedule one
 * `tick` at {@link shareProgressWakeAt}. The same split `share-handoff.ts`
 * made for the staged-file ownership (#365), for the same reason — in `hooks/`
 * because it serves one hook's protocol, not `lib/`, and with no React, no
 * DOM and no timers in it.
 *
 * What it deliberately cannot say. `retry` (activation spent, File put back,
 * still ready) and `superseded` (a newer run owns the flow) are not members of
 * {@link ShareSettled}: the first is not a failure and must not show as one
 * (#491 constraint 2), the second is not this run's news. Both map to `null`
 * in {@link settledFromOutcome}, which ends the busy phase with no outcome.
 * And `sent` means HANDED TO THE SHEET — `navigator.share` resolving proves the
 * bytes reached the OS, not that any app received them (the R-B7 note in
 * `send()`), so nothing downstream of this value may say "delivered".
 */

/** Which tap the busy phase is covering. Picks the secondary text only. */
type ShareWork = "prepare" | "send";

/**
 * What the modal can show once work has settled: the hook's three error codes,
 * plus the three send outcomes a translator can act on. `retry` and
 * `superseded` are absent by construction — see the header.
 *
 * `partial` (P1, this lane's own review round) is `sent` with a gap: the File
 * WAS handed to the sheet, but the count `send()` captured on the armed value
 * at prepare time was non-zero. Distinct from plain `sent` on purpose — a
 * facilitator who reads a completed-but-incomplete share as the same tick a
 * whole one gets collects a chapter believing it is whole, the exact defect
 * `share-outcome-glyph.ts`'s own header names for the READY-state gap Notice
 * this reuses the mark from. Reuses the `partial` mark #178 already defined
 * (`shareOutcomeGlyph`), not a fourth glyph.
 */
export type ShareSettled = ShareError | "sent" | "partial" | "dismissed";

/**
 * The gap `partial` carries — the same two counts `PreparedShare` and
 * `UseShareFlow` already track (whole units left out, and, for a book,
 * segments missing inside a chapter that did ship). Present only on a
 * `partial` settle/outcome; absent everywhere else, so a reader cannot
 * mistake it for meaning anything on `sent`.
 */
export interface ShareGap {
  readonly missing: number;
  readonly partial: number;
}

/**
 * Every settled value, derived from a `Record` so a widened union that forgets
 * the list is a compile error, not a silently shorter sweep (the #457
 * mechanism, `share-outcome-glyph.ts`).
 */
const EVERY_SETTLED: Record<ShareSettled, true> = {
  nothing: true,
  encoder: true,
  failed: true,
  sent: true,
  partial: true,
  dismissed: true,
};
export const SHARE_SETTLED = Object.keys(
  EVERY_SETTLED
) as readonly ShareSettled[];

export type ShareProgress =
  | { readonly phase: "hidden" }
  | {
      readonly phase: "busy";
      readonly work: ShareWork;
      /** When the busy phase began — the hold is measured from here. */
      readonly since: number;
      /**
       * A settle that arrived before {@link MIN_BUSY_MS} had elapsed, waiting
       * for the tick that ends the hold. `null` while nothing has settled.
       */
      readonly pending: {
        readonly settled: ShareSettled | null;
        /** Carried from the `settle` event that is being held (`partial` only). */
        readonly gap?: ShareGap;
      } | null;
    }
  | {
      readonly phase: "outcome";
      readonly settled: ShareSettled;
      /** When the outcome went up — the hold is measured from here. */
      readonly since: number;
      /** The gap `partial` names — present only when `settled` is `"partial"`. */
      readonly gap?: ShareGap;
    };

export type ShareProgressEvent =
  | { readonly type: "begin"; readonly work: ShareWork; readonly now: number }
  | {
      readonly type: "settle";
      /** `null`: the work ended with nothing to show (ready, or a retry). */
      readonly settled: ShareSettled | null;
      /** Only meaningful (and only ever passed) when `settled` is `"partial"`. */
      readonly gap?: ShareGap;
      readonly now: number;
    }
  | { readonly type: "tick"; readonly now: number }
  | { readonly type: "dismiss" };

/**
 * How long the busy modal stays up at minimum. A one-segment chapter encodes
 * in well under 100 ms, and a modal that flashes for one frame reads as a
 * glitch, not as work — the issue's own "a fast encode still reads as
 * something is happening". A settle that lands earlier is HELD until this
 * has elapsed; one that lands later shows at once, so a slow encode never
 * pays the hold twice.
 */
export const MIN_BUSY_MS = 600;

/**
 * How long the outcome glyph stays up on its own before clearing. A tap ends
 * it early (`dismiss`). Auto-clear rather than tap-to-clear, because the
 * menu's own Notice remains for every error, so nothing is lost when the
 * flash ends — and a mandatory extra tap on every success is friction for the
 * exact person the issue is about. One constant if the DRI wants the other.
 */
export const OUTCOME_HOLD_MS = 1800;

/** The resting state. One object, so an identity check tells "still hidden". */
export const HIDDEN: ShareProgress = { phase: "hidden" };

/**
 * One transition. Returns the SAME object for every event that changes
 * nothing, so the hook can skip a render and a reschedule on identity.
 *
 * The table, in words: `begin` opens busy from hidden or over a stale outcome,
 * and is ignored while already busy (a re-entrant tap must not restart the
 * hold). `settle` while busy either shows at once (hold elapsed) or is held as
 * `pending` for the tick; a second settle while one is held is ignored — the
 * first word stands. `tick` releases a held settle once the hold has elapsed,
 * and clears an outcome once its hold has. `dismiss` goes hidden from
 * anywhere. From hidden, `settle` and `tick` are stale and change nothing —
 * that is what keeps a superseded run's late sheet from flashing an outcome
 * over a newer run's menu (George R-B7-book P2).
 */
export function reduceShareProgress(
  state: ShareProgress,
  event: ShareProgressEvent
): ShareProgress {
  switch (event.type) {
    case "begin":
      if (state.phase === "busy") return state;
      return {
        phase: "busy",
        work: event.work,
        since: event.now,
        pending: null,
      };
    case "settle":
      if (state.phase !== "busy" || state.pending !== null) return state;
      if (event.now - state.since >= MIN_BUSY_MS)
        return release(event.settled, event.now, event.gap);
      return { ...state, pending: { settled: event.settled, gap: event.gap } };
    case "tick":
      if (state.phase === "busy") {
        if (state.pending === null || event.now - state.since < MIN_BUSY_MS)
          return state;
        return release(state.pending.settled, event.now, state.pending.gap);
      }
      if (state.phase === "outcome")
        return event.now - state.since >= OUTCOME_HOLD_MS ? HIDDEN : state;
      return state;
    case "dismiss":
      return state.phase === "hidden" ? state : HIDDEN;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

/** The busy phase is over: an outcome to show, or nothing to say. */
function release(
  settled: ShareSettled | null,
  now: number,
  gap?: ShareGap
): ShareProgress {
  return settled === null
    ? HIDDEN
    : { phase: "outcome", settled, since: now, gap };
}

/**
 * When the hook must next send a `tick`, or `null` when nothing is waiting on
 * time: the end of the busy hold while a settle is pending, or the end of the
 * outcome hold. A busy phase with nothing pending has nothing to wake for —
 * the settle itself will decide.
 */
export function shareProgressWakeAt(state: ShareProgress): number | null {
  switch (state.phase) {
    case "hidden":
      return null;
    case "busy":
      return state.pending === null ? null : state.since + MIN_BUSY_MS;
    case "outcome":
      return state.since + OUTCOME_HOLD_MS;
  }
}

/**
 * What a `send()` outcome becomes on screen. Exhaustive over the hook's
 * union with a `never` default, so a new outcome cannot fall into a display
 * by accident: `retry` and `superseded` are `null` — the busy phase ends and
 * nothing is shown — for the reasons the header gives.
 */
export function settledFromOutcome(outcome: ShareOutcome): ShareSettled | null {
  switch (outcome) {
    case "sent":
    case "dismissed":
    case "failed":
      return outcome;
    case "retry":
    case "superseded":
      return null;
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}
