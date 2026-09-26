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
 * event), the hook's only job is to feed it a monotonic clock reading (not
 * `Date.now()` — see `createProgressDriver`'s own `Clock`/`monotonicClock` in
 * `share-flow.ts`, Frank e915d05 P2) and to schedule one
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
 * plus the four send outcomes a translator can act on. `retry` and
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
 *
 * `unproven` (Frank a446708 P2, `share-flow.ts`'s `resolveSendOutcome`) is a
 * RESOLVED send whose route/platform cannot tell a genuine hand-off from the
 * native Android plugin's documented false-success path (a chooser dismissed
 * with Back after the activity stopped). Not `dismissed` — that means the
 * sheet is known to have closed with nothing sent, which this is not — and
 * not `sent`/`partial` either, for the reason this whole outcome UI exists
 * (#336): an affirmative tick this platform cannot back up is worse than the
 * silence that issue reported.
 */
export type ShareSettled =
  ShareError | "sent" | "partial" | "dismissed" | "unproven";

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
  /**
   * How many distinct parents hold the `partial` units — for a book, the
   * included chapters with a gap (#446). 0 whenever `partial` is 0.
   */
  readonly partialChapters: number;
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
  unproven: true,
};
export const SHARE_SETTLED = Object.keys(
  EVERY_SETTLED
) as readonly ShareSettled[];

/**
 * How far a prepare has got (#986): `done` of `total` steps have REALLY
 * finished — segments gathered for Share Chapter, chapters archived for Share
 * Book (`lib/export/chapter.ts`, `lib/export/book.ts`). A skipped item (a clip
 * that vanished, a chapter with no audio) is a finished step; a thrown one is
 * not, and nothing moves after it. No percent is stored beside these: a reader
 * derives one from `done` and `total`, so the percent can never disagree with
 * the count.
 *
 * Share Chapter's count also covers the MP3 encode (#996): after its segments
 * comes a fixed stretch of encode steps (`withEncodeSteps`,
 * `lib/export/chapter.ts`), so `done === total` means the MP3 exists, not
 * just that every segment is gathered.
 */
interface ShareSteps {
  readonly done: number;
  readonly total: number;
  /**
   * How many of the `done` steps finished with NO audio (#996) — a vanished
   * clip, a chapter with nothing recorded — so a reader can draw them hollow
   * while the count still completes. Absent until a build reports one;
   * `skipped <= done` always, and it never runs backward.
   */
  readonly skipped?: number;
  /**
   * How many of the `total` steps are ITEMS — the dots a reader draws — when
   * some of the total is not (#996): Share Chapter's total is its segments
   * plus a fixed encode stretch, and this is the segment count. Absent means
   * every step is an item (Share Book: one per chapter). Fixed for the run.
   */
  readonly items?: number;
  /**
   * WHICH items finished with no audio (#996): their 0-based positions among
   * the items, ascending, one per `skipped`, so a reader draws the hollow
   * dot where the missing segment or chapter actually is. Present whenever
   * `skipped` is. See {@link withStep} for how a position is placed.
   */
  readonly hollow?: readonly number[];
}

/**
 * The prepare's per-item result, carried into the send (#1023): which items
 * the prepare finished with no audio (`hollow`, the same positions
 * {@link ShareSteps} holds) and, when not every step was an item, how many
 * were (`items`). A send begins from `hidden` once the prepare's busy phase
 * has ended, so the prepare's `steps` are gone by then. `useShareFlow` takes
 * this snapshot with {@link carryFromPrepare} before the prepare settles and
 * hands it to the send with a `carry` event, so a reader drawing the hand-off
 * does not check an item the prepare skipped.
 */
export interface ShareCarry {
  readonly items?: number;
  readonly hollow: readonly number[];
}

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
      /**
       * The prepare's step count, absent until the build reports one (and
       * always absent on a send, which has no per-item work). See
       * {@link ShareSteps}; only a `step` event sets it, and only forward.
       */
      readonly steps?: ShareSteps;
      /**
       * The prepare's per-item result, on a send only, and only once a
       * `carry` event has put it here (#1023). See {@link ShareCarry}.
       */
      readonly carried?: ShareCarry;
    }
  | {
      readonly phase: "outcome";
      readonly settled: ShareSettled;
      /** When the outcome went up — the hold is measured from here. */
      readonly since: number;
      /** The gap `partial` names — present only when `settled` is `"partial"`. */
      readonly gap?: ShareGap;
      /** The send's {@link ShareCarry}, when the busy phase carried one. */
      readonly carried?: ShareCarry;
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
  | {
      /** One more step of a prepare finished (#986). Never moves `since`. */
      readonly type: "step";
      readonly done: number;
      readonly total: number;
      /** Of `done`, the steps that contributed no audio (#996). */
      readonly skipped?: number;
      /** Of `total`, the steps that are items (#996); absent means all. */
      readonly items?: number;
    }
  | {
      /** The prepare's per-item result, handed to a send (#1023). */
      readonly type: "carry";
      readonly carried: ShareCarry;
    }
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
 * anywhere. `step` records a prepare's count (see {@link withStep}); `carry`
 * hands a send the prepare's per-item result (see {@link withCarry}). From
 * hidden, `settle`, `tick` and `step` are stale and change nothing —
 * that is what keeps a superseded run's late sheet from flashing an outcome
 * over a newer run's menu (George R-B7-book P2).
 */
export function reduceShareProgress(
  state: ShareProgress,
  event: ShareProgressEvent
): ShareProgress {
  switch (event.type) {
    case "begin":
      if (state.phase === "busy") {
        // The only way a fresh `begin` reaches an ALREADY-busy state: every
        // other overlap is ruled out elsewhere (`prepare`'s own re-entry
        // guard, `send`'s `handoff.sending` check) except one (P2, this
        // lane's own review round — Frank). `prepare` finishes fast, settles
        // to `null` (ready, nothing to show) and is still holding out the
        // rest of MIN_BUSY_MS; the screen has already put `status: "ready"`
        // on `share`, and `share-progress.tsx` deliberately leaves focus on
        // the control the busy phase started on rather than moving it under
        // the scrim. A translator on Enter, or anyone driving "Share now" by
        // assistive technology, can activate it before that hold ends — a
        // real `send` begin, landing on a state this switch would otherwise
        // just discard. Treat it as a FRESH busy phase for the new work: the
        // alternative is silently absorbing the tap here and then, a moment
        // later, discarding the send's own settle too (the `pending !== null`
        // guard below), which drops send's real outcome with no glyph at
        // all — the exact silent-success defect (#336/#491) this whole modal
        // exists to fix.
        if (
          state.work === "prepare" &&
          event.work === "send" &&
          state.pending?.settled === null
        )
          return {
            phase: "busy",
            work: "send",
            since: event.now,
            pending: null,
          };
        return state;
      }
      return {
        phase: "busy",
        work: event.work,
        since: event.now,
        pending: null,
      };
    case "settle":
      if (state.phase !== "busy" || state.pending !== null) return state;
      if (event.now - state.since >= MIN_BUSY_MS)
        return release(event.settled, event.now, event.gap, state.carried);
      return { ...state, pending: { settled: event.settled, gap: event.gap } };
    case "tick":
      if (state.phase === "busy") {
        if (state.pending === null || event.now - state.since < MIN_BUSY_MS)
          return state;
        return release(
          state.pending.settled,
          event.now,
          state.pending.gap,
          state.carried
        );
      }
      if (state.phase === "outcome")
        return event.now - state.since >= OUTCOME_HOLD_MS ? HIDDEN : state;
      return state;
    case "step":
      return withStep(state, event);
    case "carry":
      return withCarry(state, event.carried);
    case "dismiss":
      return state.phase === "hidden" ? state : HIDDEN;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

/**
 * A `step` event, applied only where it can be true (#986): a busy PREPARE
 * whose build is still running (`pending === null` — once a settle is held the
 * build has returned, so a later step is stale). The count is whole numbers,
 * `0 <= done <= total` with `total >= 1`, and it only moves forward within one
 * total — so the number a translator watches never passes the end, never runs
 * backward, and never jumps to a different run's scale. Anything else, and a
 * step identical to the current one, returns the same object.
 *
 * `skipped` (#996), when a step carries it, is a whole number with
 * `0 <= skipped <= done` that never runs backward; a step without one keeps
 * the last. A step whose `skipped` breaks that is rejected whole — its
 * `done` is not taken either, since the two came from one report.
 *
 * `items` (#996) is fixed by the run's first step, like `total`: a whole
 * number with `1 <= items <= total`. A later step may repeat it or leave it
 * out, but not change it, nor bring one to a run whose first step had none.
 * Without it every step is an item.
 *
 * `hollow` places each newly skipped item. The exports report once per
 * finished item, in order (`StepReporter`, `lib/export/chapter.ts`), so the
 * item a step newly skips is the one it just finished: position `done - 1`,
 * or the last item once `done` is past the items. Should one step ever skip
 * more than one, they take the latest finished positions not already hollow.
 * A skip with no finished item left to place it on is rejected whole.
 */
function withStep(
  state: ShareProgress,
  event: Extract<ShareProgressEvent, { type: "step" }>
): ShareProgress {
  const { done, total } = event;
  if (state.phase !== "busy" || state.work !== "prepare") return state;
  if (state.pending !== null) return state;
  if (!Number.isInteger(done) || !Number.isInteger(total)) return state;
  if (total < 1 || done < 0 || done > total) return state;
  const prev = state.steps;
  if (prev !== undefined && (prev.total !== total || done <= prev.done))
    return state;
  const items = prev === undefined ? event.items : prev.items;
  if (event.items !== undefined && event.items !== items) return state;
  if (
    items !== undefined &&
    (!Number.isInteger(items) || items < 1 || items > total)
  )
    return state;
  const base = items === undefined ? { done, total } : { done, total, items };
  const nextSkipped = event.skipped ?? prev?.skipped;
  if (nextSkipped === undefined) return { ...state, steps: base };
  if (!Number.isInteger(nextSkipped) || nextSkipped < 0) return state;
  if (nextSkipped > done || nextSkipped < (prev?.skipped ?? 0)) return state;
  const hollow = placeHollow(
    prev?.hollow ?? [],
    nextSkipped,
    Math.min(done, items ?? total)
  );
  if (hollow === null) return state;
  return { ...state, steps: { ...base, skipped: nextSkipped, hollow } };
}

/**
 * `hollow` grown to `skipped` positions: each new one is the latest of the
 * first `finished` items not already hollow. `null` when none is left.
 */
function placeHollow(
  hollow: readonly number[],
  skipped: number,
  finished: number
): readonly number[] | null {
  const taken = new Set(hollow);
  const added: number[] = [];
  for (let at = finished - 1; at >= 0; at--) {
    if (added.length === skipped - hollow.length) break;
    if (!taken.has(at)) added.push(at);
  }
  if (added.length < skipped - hollow.length) return null;
  return [...hollow, ...added].sort((a, b) => a - b);
}

/**
 * The snapshot a send carries (#1023): the prepare's `hollow` positions and
 * `items` count, read while the prepare's busy phase still holds its count.
 * `undefined` when there is nothing to carry: not a busy prepare, or one
 * whose build never reported a count.
 */
export function carryFromPrepare(state: ShareProgress): ShareCarry | undefined {
  if (state.phase !== "busy" || state.work !== "prepare") return undefined;
  const steps = state.steps;
  if (steps === undefined) return undefined;
  const hollow = steps.hollow ?? [];
  return steps.items === undefined
    ? { hollow }
    : { items: steps.items, hollow };
}

/**
 * A `carry` event, applied only to a busy SEND whose settle has not arrived
 * and which carries nothing yet: the first snapshot stands, as the first
 * settle does. `hollow` must be whole, non-negative and strictly ascending,
 * and `items`, when present, a whole number of at least 1 — the shape
 * {@link withStep} builds. Anything else returns the same object.
 */
function withCarry(state: ShareProgress, carried: ShareCarry): ShareProgress {
  if (state.phase !== "busy" || state.work !== "send") return state;
  if (state.pending !== null || state.carried !== undefined) return state;
  const { items, hollow } = carried;
  if (items !== undefined && (!Number.isInteger(items) || items < 1))
    return state;
  for (let i = 0; i < hollow.length; i++) {
    const at = hollow[i]!;
    if (!Number.isInteger(at) || at < 0) return state;
    if (i > 0 && at <= hollow[i - 1]!) return state;
  }
  return { ...state, carried };
}

/** The busy phase is over: an outcome to show, or nothing to say. */
function release(
  settled: ShareSettled | null,
  now: number,
  gap?: ShareGap,
  carried?: ShareCarry
): ShareProgress {
  if (settled === null) return HIDDEN;
  return carried === undefined
    ? { phase: "outcome", settled, since: now, gap }
    : { phase: "outcome", settled, since: now, gap, carried };
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
 * Whether the share overlay is showing and therefore OWNS the screen (George
 * r1 P2 #1/#2, `#491`). While true, the menu it covers must not close or arm
 * anything — Escape/a scrim tap can no longer reach the menu behind the
 * overlay, and the outcome hold keeps the menu mounted for up to
 * {@link OUTCOME_HOLD_MS} after a send resolves, long enough for a keyboard,
 * switch, or screen-reader user to reach a control the pointer-only scrim
 * cannot: George found this window let Escape close the menu mid-send (the
 * `reset()` it calls already no-ops, but closing the menu around it does not)
 * and let Tab reach the book menu's Delete during the flash, arming a confirm
 * under an overlay saying the book had just been shared.
 *
 * ONE predicate, so every site that used to assume `hidden` was the only
 * resting phase — `onCloseChapterMenu`/`onCloseShareMenu`, `listInert`/the
 * shelf's `inert`, the book menu's Rename and Delete — derives its guard from
 * this rather than repeating `progress.phase !== "hidden"` at each call site.
 */
export function shareOverlayOwnsScreen(progress: ShareProgress): boolean {
  return progress.phase !== "hidden";
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
    case "unproven":
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
