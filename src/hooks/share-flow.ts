import { useCallback, useEffect, useRef, useState } from "react";

import {
  type EncoderHealth,
  EncoderFailedError,
  EncoderStalledError,
  encoderHealth,
} from "./mp3-codec";
import { reportFailure } from "./report-failure";
import { createShareHandoff } from "./share-handoff";
import {
  HIDDEN,
  type ShareGap,
  type ShareProgress,
  type ShareProgressEvent,
  reduceShareProgress,
  settledFromOutcome,
  shareProgressWakeAt,
} from "./share-progress";
import {
  type StagedShare,
  nativeShare,
  readShareEnvironment,
  selectShareRoute,
} from "./share-target";

/**
 * The two-gesture share flow, shared by Share Chapter and Share Book (B7, A4).
 *
 * Chapter and book share differ only in what tap 1 builds — one MP3 vs. a zip of
 * chapter MP3s — and in the copy the screen maps their codes to. Everything hard
 * about the flow is the same, so it lives here once: the iOS user-activation
 * contract, the run-generation token, and the two re-entry guards. Each caller is
 * a thin wrapper that supplies a {@link BuildShareFile} and its own strings.
 *
 * WHAT the file is handed to is `share-target.ts`: the Web Share API in a
 * browser, or Capacitor's Share plugin inside the native shell, where the
 * WebView may expose no Web Share at all (#336). The route is decided once, at
 * the two gates in `prepare`, and carried on the armed value — so the two
 * gestures cannot disagree about it and `send` probes nothing.
 *
 * The native route also STAGES the file to the app cache in `prepare`, not in
 * `send` (George R5 P2): it is the slow half, tap 1 is the gesture that already
 * paints a busy state for slow work, and tap 2 must stay one call with no await
 * before it. That is what keeps "the sheet opens in this gesture" true on both
 * routes, which is what every caller's copy promises.
 *
 * Why two gestures. iOS grants a tap a short user-activation window and revokes
 * it the moment the call stack awaits. Encoding walks IndexedDB and runs a
 * synchronous MP3 encode (a whole book, several of them) — far past that window —
 * so a `navigator.share` after the encode is refused with `NotAllowedError` and
 * the sheet never opens. The same rule `use-audio-session.ts` obeys for
 * `resumeAudioContext`. So tap 1 encodes and stashes the File, and tap 2 — a
 * fresh activation — hands it to the sheet with no await before the call.
 */

/**
 * Why a share did not proceed. A CODE, not a message — the screen maps it to a
 * translator-facing string, so this browser-boundary hook stays free of UI copy.
 * `nothing`: there was no recorded audio to share. `encoder`: the ENCODER is
 * the problem (#166) — it stalled, or it failed again while its health already
 * reads `failing` (see `classifyPrepareError`). "Try again" is still the right
 * first move, but a restart may be needed, and the Books shelf that says so is
 * not on screen while a chapter is open (George R2 P3-2). `failed`: anything
 * else — a first encoder failure, storage, the share sheet, an unsupported
 * browser.
 */
export type ShareError = "nothing" | "encoder" | "failed";

/**
 * Which code a failed PREPARE (tap 1) surfaces.
 *
 * `encoder` for a stall, and for an ordinary ENCODER failure
 * (`EncoderFailedError`) once the encoder's health already reads `failing`
 * (George R3 P2-1). A purged worker chunk (#182) or a worker that dies on every
 * encode never stalls — it errors — and by the time this runs `encodeInWorker`
 * has already counted that error. The Books shelf that would say so is
 * unmounted while a chapter is open, so this line is the only place a
 * translator on Segments can learn a restart is needed. Below the threshold an
 * encoder failure stays `failed`: "try again" is honest there.
 *
 * Anything that is NOT the encoder's — an IndexedDB read in the share build, an
 * export error — stays `failed` whatever the health reads (Frank R4 P2). The
 * encoder may be unhealthy too, but it did not cause this failure, and a
 * restart line would send the translator after the wrong problem.
 *
 * `health` is a parameter, defaulted to the live store, so the decision is a
 * pure function a test can drive.
 */
export function classifyPrepareError(
  cause: unknown,
  health: EncoderHealth = encoderHealth()
): ShareError {
  if (cause instanceof EncoderStalledError) return "encoder";
  if (cause instanceof EncoderFailedError && health === "failing")
    return "encoder";
  return "failed";
}

/**
 * A failed prepare, settled: reported to the app's ONE failure sink and
 * classified for the screen (George R3 P3-4). The Finished sweep moved onto
 * `reportFailure` in #166; a Share that failed the same way was still only a
 * `console.error`, which AGENTS.md is explicit is not a channel.
 */
export function settlePrepareFailure(
  cause: unknown,
  health: EncoderHealth = encoderHealth()
): ShareError {
  reportFailure(cause, "share-prepare");
  return classifyPrepareError(cause, health);
}

/**
 * `idle`: nothing prepared. `preparing`: tap 1's encode is in flight (busy).
 * `ready`: a File is stashed and the send gesture (tap 2) is armed.
 */
export type ShareStatus = "idle" | "preparing" | "ready";

/**
 * What a send gesture resolved to, so the caller can react (e.g. close a menu).
 *
 * `superseded` means the sheet settled for a run a newer prepare had already
 * replaced (a menu closed + a different item armed while the OS sheet was up).
 * The stale send did NOT touch the newer run's File — and callers must not act
 * on it either. A caller that closes-and-resets on `sent`/`dismissed` would
 * otherwise drop the File the new run just prepared (George R-B7-book P2).
 */
export type ShareOutcome =
  "sent" | "dismissed" | "retry" | "failed" | "superseded";

/**
 * The File tap 1 built, plus how many units it had to leave out (segments for a
 * chapter, chapters for a book). Surfaced so a share with gaps does not go out
 * "as if whole" without saying so.
 *
 * `partial` is a second, finer-grained count a builder MAY also carry: units
 * left out from inside something that otherwise made it in (today, only Share
 * Book uses it — segments missing inside chapters that did ship, #116).
 * Omitted (or 0) for a builder with nothing at that finer grain, e.g. Share
 * Chapter, whose `missing` is already at the finest grain there is.
 */
interface PreparedShare {
  readonly file: File;
  readonly missing: number;
  readonly partial?: number;
}

/**
 * Build the File to share. Receives `isCurrent`, which goes false when the run is
 * superseded (menu close, `reset`, or unmount), and `signal`, which aborts at the
 * same moment. A builder that awaits MUST thread both through to the underlying
 * export: `isCurrent` skips starting an encode for a share already dismissed,
 * and `signal` (B8) terminates one already running in the worker. Resolve to
 * the built File + missing count; `"nothing"` when there is no audio to share;
 * `null` when the run was cancelled part-way (`isCurrent()` went false). An
 * abort may also surface as a rejection — the flow ignores it once the run is
 * stale.
 */
type BuildShareFile = (
  isCurrent: () => boolean,
  signal: AbortSignal
) => Promise<PreparedShare | "nothing" | null>;

/**
 * What tap 1 arms for tap 2: the File (plus its native staged copy, if any)
 * and the gap counts `prepare` read off the {@link PreparedShare} that built
 * it. Carrying `missing`/`partial` on the ARMED value, not just in `useState`
 * (P1, this lane's own review round), is what lets `send()` know whether the
 * File it is about to hand over has a gap: the hook clears its `missing`/
 * `partial` state to 0 as part of the very same "shared" transition that
 * settles the modal, so by the time a render could read them they are
 * already zero — see the comment at the `"sent"` settle below.
 */
interface ArmedShare {
  readonly file: File;
  readonly staged: StagedShare | null;
  readonly missing: number;
  readonly partial: number;
}

/**
 * How to treat a `navigator.share` rejection.
 *
 * `dismissed`: the user closed the sheet (`AbortError`) — expected, not a failure
 * to alarm a translator with. `failed`: a real error.
 *
 * `NotAllowedError` is overloaded, so `hadActivation` — whether user activation
 * was live at the moment we called `share` — decides it. With NO active
 * activation it means the tap's activation was spent, and the prepared File still
 * stands, so `retry` lets a fresh tap hand it over. WITH activation live it is a
 * standing refusal (a Permissions-Policy block on Web Share), which no number of
 * taps will clear — that is `failed`, so the translator gets an error channel
 * instead of a "Share now" button that loops forever (Frank R-B7).
 */
export function classifyShareError(
  cause: unknown,
  hadActivation: boolean
): ShareOutcome {
  if (cause instanceof DOMException) {
    if (cause.name === "AbortError") return "dismissed";
    if (cause.name === "NotAllowedError")
      return hadActivation ? "failed" : "retry";
  }
  return "failed";
}

/**
 * Whether a File that WAS handed to the sheet still leaves a gap behind —
 * the pure decision that picks `sent` vs `partial` at `send()`'s own settle
 * (P1, this lane's own review round: a completed-but-incomplete share must
 * not wear the same tick a whole one gets — `share-progress.ts`'s header on
 * `ShareSettled` has the failure this closes).
 *
 * Reads the counts off the ARMED value `send()` is holding, not off this
 * hook's `missing`/`partial` state: the success branch's own `setMissing(0)`/
 * `setPartial(0)` already race those to 0 as part of the SAME transition that
 * settles the modal, so by the render that settle produces they would read
 * as whole. The armed value was written once, at `prepare` time, and cannot
 * have raced — pulled out as a pure function so the decision is
 * unit-testable without a renderer (#197), the same shape `classifyShareError`
 * above already uses.
 */
export function sentGap(armed: {
  readonly missing: number;
  readonly partial: number;
}): ShareGap | undefined {
  return armed.missing > 0 || armed.partial > 0
    ? { missing: armed.missing, partial: armed.partial }
    : undefined;
}

export interface UseShareFlow {
  readonly status: ShareStatus;
  readonly error: ShareError | null;
  /** Units left out of the prepared File (segments or chapters). 0 until ready. */
  readonly missing: number;
  /**
   * The finer-grained count a builder attached via {@link PreparedShare.partial}
   * — 0 for a builder that never carries one. 0 until ready.
   */
  readonly partial: number;
  /**
   * Tap 1: run `build` to encode and stash the File for the send gesture. Never
   * rejects — a reason surfaces through `error`.
   */
  prepare: (build: BuildShareFile) => Promise<void>;
  /**
   * Tap 2: hand what tap 1 armed to the OS share sheet. MUST be called straight
   * from a user gesture: the sheet call — `navigator.share` in a browser, the
   * Share plugin natively, whose file tap 1 already staged — is made with no
   * await before it, so the activation the web platform requires is still live.
   * The caller must not await anything before `send()` inside the same gesture.
   */
  send: () => Promise<ShareOutcome>;
  /** Drop any prepared file and return to idle (menu close, unmount). */
  reset: () => void;
  /**
   * The modal timeline over the flow (#491): busy while tap 1 or tap 2 works,
   * held for a minimum so a fast encode still reads as work, then ONE outcome
   * glyph — handed to the sheet, dismissed, nothing, failed — for a moment.
   * `status` above is unchanged and still drives the Share control; this is a
   * presentation timeline the screens render as a sibling of their menu.
   * `send()` resolves only once this has returned to hidden, so a caller that
   * closes its menu on `sent`/`dismissed` closes it AFTER the glyph, not under
   * it.
   */
  readonly progress: ShareProgress;
  /** End an outcome flash early (a tap on it). The normal close follows. */
  dismissProgress: () => void;
}

/**
 * The generic two-gesture share state machine. See the file header for why one
 * gesture cannot work. The encode runs in a Web Worker (B8, #34), so `preparing`
 * no longer janks the screen and a cancel (menu close, Back) actually stops it;
 * it is still a busy state rather than a meter — nothing reports progress yet.
 */
export function useShareFlow(): UseShareFlow {
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [error, setError] = useState<ShareError | null>(null);
  const [missing, setMissing] = useState(0);
  const [partial, setPartial] = useState(0);
  // What tap 1 prepared, waiting for the send gesture, and whether tap 2 owns
  // it right now. Extracted into `share-handoff.ts` (#365) rather than a ref
  // pair: `send` still takes ownership SYNCHRONOUSLY inside the gesture —
  // before any render — so the sheet call keeps the activation the tap
  // granted, but the ownership handoff itself is now a plain state machine,
  // provable in Node instead of only by reading this file's control flow.
  // `staged` is non-null on the native route only: the file is already in the
  // app cache by then, so tap 2 is one plugin call on both routes (George R5
  // P2).
  const handoffRef = useRef<ReturnType<
    typeof createShareHandoff<ArmedShare>
  > | null>(null);
  const handoff = (handoffRef.current ??= createShareHandoff());
  // A generation token invalidating an in-flight `prepare`. Both unmount AND
  // `reset` bump it, so a prepare that resolves after the screen is gone (Back
  // mid-encode) or after the menu was closed mid-gather does not `setState` or
  // arm a File behind a closed menu. The build awaits per unit, and the menu's
  // close/scrim stay live during those yields, so this race is reachable.
  const runIdRef = useRef(0);
  // Re-entry guard for tap 1: a second tap before the first render commits must
  // not start a second (expensive) encode.
  const preparingRef = useRef(false);
  // The in-flight prepare's abort handle (B8). Bumping the run token makes a
  // late result ignored; aborting is what stops the worker from finishing an
  // encode nobody will read. Both happen together in `reset` and on unmount.
  const abortRef = useRef<AbortController | null>(null);
  // The modal timeline (#491). The machine is `share-progress.ts`; the driver
  // below is its browser glue and nothing more, created once per hook
  // instance the way `handoffRef` is, so Books' flow and a Segments screen's
  // flow never share a timer. `progress` mirrors the driver's state for
  // render.
  const [progress, setProgress] = useState<ShareProgress>(HIDDEN);
  const modalRef = useRef<ReturnType<typeof createProgressDriver> | null>(null);
  const modal = (modalRef.current ??= createProgressDriver(setProgress));
  const dismissProgress = useCallback(() => {
    modal.dispatch({ type: "dismiss" });
  }, [modal]);

  useEffect(
    () => () => {
      runIdRef.current += 1;
      abortRef.current?.abort();
      // The screen is gone: take the modal down with it and release any
      // `send()` still waiting on the flash, so nothing pends past unmount.
      modal.dispatch({ type: "dismiss" });
      // The screen is gone; a staged file armed for a send that will never come
      // has no reader. Same fire-and-forget as `reset`. `dropArmed()` returns
      // `null` if `send()` already took ownership (#365) — that in-flight send
      // keeps running after unmount and owns its own cleanup; this must not
      // reach into it.
      const armed = handoff.dropArmed();
      if (armed?.staged != null) void nativeShare.discard(armed.staged);
    },
    [handoff, modal]
  );

  const prepare = useCallback(
    async (build: BuildShareFile): Promise<void> => {
      // Already encoding, already armed, or a chooser is still up: ignore. (The
      // screen hides the prepare control while `ready`, so this is a re-entry
      // backstop.) `handoff.isBusy()` covers all three: `send` takes ownership
      // synchronously when it starts (Frank R6 P2), so "armed" alone no longer
      // covers the window in which a share is in flight — and a `reset()` while
      // the sheet is open drops the flow to idle, putting tap 1 back on screen
      // (George R6 P2). Without this, a tap there would start a second encode
      // behind a live chooser.
      if (preparingRef.current || handoff.isBusy()) return;
      // Fail before the encode, not after: a browser with no Web Share should not
      // pay for a whole encode only to be told it cannot share it. The file-level
      // check still runs post-encode (it needs the File), but the capability
      // itself is knowable now (George R-B7). Inside the native shell there is
      // nothing to fail on — the plugin needs no Web Share (#336).
      if (selectShareRoute(readShareEnvironment(), null) === "unsupported") {
        setError("failed");
        return;
      }
      preparingRef.current = true;
      // Claim this run. A later `reset` (menu close) or unmount bumps the token,
      // and every resumption below bails when its captured id is stale.
      const runId = (runIdRef.current += 1);
      const current = () => runId === runIdRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setMissing(0);
      setPartial(0);
      setStatus("preparing");
      // The modal goes up with the busy status (#491). Not before the
      // unsupported gate above: a browser with no Web Share gets the error
      // Notice, not a busy flash for work that never starts.
      modal.dispatch({ type: "begin", work: "prepare", now: Date.now() });
      // Yield once so `preparing` paints before the gather starts (its awaits
      // also yield, but a tiny share can return before the browser paints).
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        // `build` threads `current` and the signal through to the export so a
        // cancel during the gather skips the encode and a cancel during the encode
        // stops the worker. It returns "nothing" for a genuinely empty share and
        // null when it was cancelled mid-build.
        const prepared = await build(current, controller.signal);
        if (!current()) return;
        // "nothing" (no audio) and null (cancelled, but not yet observed as such)
        // both settle back to idle; only "nothing" is a reason to surface. A null
        // here with the run still current is unreachable — a cancel bumps the token,
        // so the `!current()` bail above would have caught it — but it is folded in
        // rather than left to narrow to `PreparedShare` on a wrong assumption.
        if (prepared === null || prepared === "nothing") {
          if (prepared === "nothing") setError("nothing");
          setStatus("idle");
          // "nothing" is an outcome the modal shows (the empty tray); a null
          // has nothing to say, so the busy phase just ends.
          modal.dispatch({
            type: "settle",
            settled: prepared === "nothing" ? "nothing" : null,
            now: Date.now(),
          });
          return;
        }
        const { file } = prepared;
        // The browser may still refuse this particular File — Android Chrome's
        // Web Share allowlist has no `application/zip`, which is #272. The native
        // route does not consult that gate at all; see `selectShareRoute`.
        const route = selectShareRoute(readShareEnvironment(), file);
        if (route === "unsupported") {
          setError("failed");
          setStatus("idle");
          modal.dispatch({
            type: "settle",
            settled: "failed",
            now: Date.now(),
          });
          return;
        }
        // The native write happens HERE, on tap 1, not in `send` (George R5 P2).
        // It is the slow half — a book zip crosses the bridge in 768 KB chunks —
        // and this is the gesture that already has a busy state for slow work.
        // Doing it in `send` left the menu reading `ready` with no sign anything
        // was happening, and made "hands the file to the sheet in this gesture"
        // false on native. The same `controller.signal` that stops the encode
        // stops the write, so closing the menu mid-write cancels it and takes the
        // partial file with it.
        const staged =
          route === "native"
            ? await nativeShare.stage(file, controller.signal)
            : null;
        if (!current()) {
          // Cancelled while staging, but the write finished first: the File is
          // nobody's now, so do not leave it in the cache. Fire-and-forget — the
          // run is over and a cleanup failure is not this screen's news.
          if (staged !== null) void nativeShare.discard(staged);
          return;
        }
        handoff.arm({
          file,
          staged,
          missing: prepared.missing,
          partial: prepared.partial ?? 0,
        });
        setMissing(prepared.missing);
        setPartial(prepared.partial ?? 0);
        setStatus("ready");
        // Ready is not an outcome: the busy phase ends (after its minimum
        // hold) and the primary "Share now" control is what the person sees.
        modal.dispatch({ type: "settle", settled: null, now: Date.now() });
      } catch (cause) {
        // A stale run's rejection — including the AbortError its own cancel
        // produced — is not this screen's news.
        if (!current()) return;
        const settled = settlePrepareFailure(cause);
        setError(settled);
        setStatus("idle");
        modal.dispatch({ type: "settle", settled, now: Date.now() });
      } finally {
        // Only clear the guard for the run that still owns it. A stale run whose
        // token was bumped by `reset` must NOT release a newer run's guard, or a
        // further tap would start a third full encode over the same source.
        if (current()) {
          preparingRef.current = false;
          if (abortRef.current === controller) abortRef.current = null;
        }
      }
    },
    [handoff, modal]
  );

  const send = useCallback(async (): Promise<ShareOutcome> => {
    // A share is already in flight: ignore this tap and leave the File armed, so
    // a double-tap cannot open a second share whose rejection drops the File.
    if (handoff.sending) return "retry";
    // Take ownership of the armed value SYNCHRONOUSLY, before any await — the
    // one property `share-handoff.ts` (#365) exists to prove. From here the
    // staged cache file belongs to this send, not to the handoff's `armed` —
    // so a `reset()` or an unmount while the chooser is up cannot discard the
    // file the chooser is holding (Frank R6 P2). Deleting a staged file
    // mid-handoff is earlier than the deletion the rest of this module already
    // refuses to do: the recipient has not merely failed to finish, it has not
    // started. The `retry` arm below puts it back.
    const armed = handoff.take();
    if (armed === null) {
      // Reachable only through a guard hole (ready with no armed File); surface it
      // rather than no-op silently behind a "Share now" that does nothing. Routed
      // through the same begin/settle pair every other outcome takes (P3, this
      // lane's own review round) so the modal's invariant — every `send()`
      // outcome ends in exactly one glyph — holds on this path too, instead of
      // silently falling back to the menu's inline error Notice alone.
      modal.dispatch({ type: "begin", work: "send", now: Date.now() });
      setError("failed");
      setStatus("idle");
      modal.dispatch({ type: "settle", settled: "failed", now: Date.now() });
      return "failed";
    }
    // A reset/unmount while the sheet is open must not write state afterwards.
    const runId = runIdRef.current;
    const current = () => runId === runIdRef.current;
    // The modal goes up NOW, before the sheet call (#491). A synchronous state
    // write, not an await, so the activation contract below still holds: the
    // sheet call is still the first await in this gesture.
    modal.dispatch({ type: "begin", work: "send", now: Date.now() });
    // Whether activation is live at the call decides how a NotAllowedError reads
    // (see classifyShareError). Read it immediately before `share`.
    const hadActivation = navigator.userActivation?.isActive ?? false;
    // Which route this is was settled at prepare time and is carried by the
    // armed value, so the two gestures cannot disagree about it — and no
    // environment probe happens in the gesture. Either way exactly ONE call
    // follows, with no await before it: the sheet opens in this gesture on both
    // routes, which is what every caller's copy already promises.
    try {
      if (armed.staged !== null) {
        // The file is already in the cache; this is only the chooser. Native
        // share needs no user activation — the plugin starts the chooser as an
        // Android Intent / a UIActivityViewController, not the WebView — but it
        // is called first here anyway, so the two routes have one shape.
        // ONE call, and deliberately no restage-on-failure here.
        //
        // The staged file can be gone by tap 2 — `Directory.Cache` is what the
        // OS reclaims first, and this window spans however long the menu sits on
        // "Share now" (George R6 P2). Writing it again from `armed.file` looks
        // like the obvious recovery, and it was tried: it puts a
        // multi-megabyte write back INSIDE `send`, which is the exact shape this
        // round removed, and it immediately grew the defect that shape always
        // grows — an uncancellable write that opens a chooser over a screen the
        // translator already closed (Frank R6 P2). `send` stays one call.
        //
        // The flow already has a recovery, and it is the ordinary one: this
        // reports `failed`, the menu stays open, and Share chapter/book
        // re-prepares — re-encode and re-stage together, under the busy state
        // that exists for slow work. The cost is a re-encode, not a lost
        // recording: chapter and book audio are in IndexedDB throughout. That is
        // an accepted residual, written down rather than patched over.
        await nativeShare.send(armed.staged);
      } else {
        // `navigator.share` is invoked synchronously here: an async function runs
        // to its first await, and this call IS that boundary, so no work precedes
        // it and the tap's user activation is still valid. Pass ONLY `files`:
        // adding `title` alongside a file is a known iOS share-target bug where
        // some apps (WhatsApp/Signal) take the title and drop the file while
        // `share` still resolves — the File already carries its name (George
        // R-B7).
        await navigator.share({ files: [armed.file] });
      }
      // Shared. If a newer run has taken over (a `reset` while the sheet was open
      // bumped the token and may have armed a NEW File), leave its state alone AND
      // tell the caller `superseded` so it does not close/reset over the new run
      // (George R-B7-book P2). Only the owning run clears the File.
      if (!current()) return "superseded";
      // The handoff's `armed` was cleared when `take()` ran; the file went to the OS.
      setStatus("idle");
      setMissing(0);
      setPartial(0);
      // Handed to the sheet — which is all a resolve proves (see the R-B7
      // note above and `resolveProvesDelivery`): the glyph says "handed
      // over", never "delivered". `sentGap` reads the gap off the ARMED
      // value, not off `missing`/`partial` state (see its own docblock: the
      // `setState`s just above already raced those to 0 as part of this same
      // transition). A gap shows `partial`'s own mark, not the plain tick
      // `sent` wears — the outcome the modal shows must not say "this chapter
      // went out whole" when it did not (`share-outcome-glyph.ts`'s own
      // header names exactly this collision for the ready-state Notice; the
      // modal must not reintroduce it one screen later). Either way this send
      // genuinely handed a File to the sheet, so `send()`'s own return value
      // to the caller stays `"sent"` — only the modal's glyph differs. Then
      // hold this send open until the flash has cleared, so the caller's
      // close-on-sent lands after it.
      const gap = sentGap(armed);
      modal.dispatch({
        type: "settle",
        settled: gap ? "partial" : "sent",
        gap,
        now: Date.now(),
      });
      await modal.hidden();
      return "sent";
    } catch (cause) {
      const outcome = classifyShareError(cause, hadActivation);
      if (outcome === "retry" && armed.staged === null) {
        // Activation was spent — the File still stands, so put it back and stay
        // `ready` so another tap can hand it over. Not a failure the translator
        // should see — and not an outcome the modal shows: the busy phase
        // ends and "Share now" is what remains (#491 constraint 2). Only if
        // this run still owns the flow: if a newer one has taken over, the
        // File is nobody's and is simply dropped.
        if (current()) {
          handoff.restore(armed);
          modal.dispatch({ type: "settle", settled: null, now: Date.now() });
          await modal.hidden();
        }
        return "retry";
      }
      // A native `retry` does NOT get its staged value back (George R6 P3):
      // `nativeShare.send` removes the staged directory on ANY rejection, so
      // restoring it would arm a URI whose file is already gone and the next tap
      // would fail against it. Not reachable today — `retry` needs a DOMException
      // `NotAllowedError` and the plugin rejects with a plain Error — but the
      // composition is wrong regardless, so it falls through to idle below and
      // the translator re-prepares, which restages as well as re-encodes.
      // A newer run owns the flow: don't touch its state and don't let the caller
      // act on this stale settle.
      if (!current()) return "superseded";
      if (outcome === "failed") console.error("Sharing failed", cause);
      // Dismissed or a real failure: end the flow for the run that still owns it.
      // The staged cache file is already gone — `nativeShare.send` removes its
      // own directory on a rejection, because a refused chooser is the one piece
      // of evidence that nothing received it. The handoff's `armed` was cleared
      // when `take()` ran.
      setStatus("idle");
      setMissing(0);
      setPartial(0);
      if (outcome === "failed") setError("failed");
      // `dismissed` and `failed` are outcomes the modal shows; a native
      // `retry` that fell through to idle (above) is not, and maps to null —
      // one table, `settledFromOutcome`, never a hand-mapped case here.
      modal.dispatch({
        type: "settle",
        settled: settledFromOutcome(outcome),
        now: Date.now(),
      });
      await modal.hidden();
      return outcome;
    } finally {
      handoff.finishSending();
    }
  }, [handoff, modal]);

  const reset = useCallback(() => {
    // A send is irreversibly in flight: tap 2's activation is spent and the
    // native chooser (or `navigator.share`) has already been asked, so a scrim
    // tap or menu-close here can discard this flow's own bookkeeping but
    // cannot cancel the outstanding call (P2, this lane's own review round —
    // the modal this lane adds is what first puts a full-screen scrim, and its
    // cancel affordance, over a call with no cancel). Bumping the run token
    // below would make `send()`'s own `current()` check read false the moment
    // the OS resolves, so a share that genuinely went out returns
    // `"superseded"` and is dropped with NO glyph and NO Notice — reproducing
    // the exact "succeeded silently" defect (#336/#491) this whole modal
    // exists to fix, in the window this modal itself creates. So: no-op while
    // `handoff.sending`, and let `send()`'s own settle end the flow instead.
    if (handoff.sending) return;
    // Bump the token so an in-flight prepare (mid-gather) bails instead of arming
    // a File behind the now-closed menu, and abort so one mid-encode stops the
    // worker rather than finishing for nobody.
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    // A file already staged in the cache for a share that is now abandoned has
    // no reader and never will, so it goes. Fire-and-forget: `reset` runs from a
    // scrim tap and must not wait on the filesystem, and `discard` never
    // rejects. `dropArmed()` returns null if `send()` already took ownership
    // (#365) — clearing `sending` here would let a second tap open a second
    // chooser over the same file while the first is still up, which is the
    // double-tap the guard exists for (George R5 P2, in part: the rest is that
    // `send` is now short) — so `reset()` never touches it; only the send that
    // owns it calls `finishSending()`.
    const armed = handoff.dropArmed();
    if (armed?.staged != null) void nativeShare.discard(armed.staged);
    preparingRef.current = false;
    setStatus("idle");
    setError(null);
    setMissing(0);
    setPartial(0);
    // The menu is closing: the modal goes with it, whatever phase it is in,
    // and any `send()` waiting on the flash resolves now rather than after a
    // hold nobody is looking at.
    modal.dispatch({ type: "dismiss" });
  }, [handoff, modal]);

  return {
    status,
    error,
    missing,
    partial,
    prepare,
    send,
    reset,
    progress,
    dismissProgress,
  };
}

/**
 * The browser glue around `share-progress.ts`'s machine (#491), and nothing
 * more: it owns the current state (a dispatch must know the NEXT state
 * synchronously, to schedule the wake and to release `send()`), ONE timer for
 * the next tick, and the `send()` calls waiting for the outcome flash to
 * clear. `Date.now()` and `setTimeout` appear here only — the machine takes
 * `now` as data, which is what makes the hold provable in Node
 * (`tests/share-progress.test.ts`); this driver is review-only, like the rest
 * of this file's React glue.
 *
 * A closure rather than a `useCallback`, because the tick it schedules calls
 * back into itself, and `react-hooks/immutability` (rightly) refuses a hook
 * callback that reads its own binding before it is declared. Created once
 * per hook instance through a ref, the way `createShareHandoff` is.
 */
function createProgressDriver(onChange: (next: ShareProgress) => void) {
  let state: ShareProgress = HIDDEN;
  let wake: ReturnType<typeof setTimeout> | null = null;
  let waiters: (() => void)[] = [];
  const dispatch = (event: ShareProgressEvent): void => {
    const next = reduceShareProgress(state, event);
    if (next !== state) {
      state = next;
      onChange(next);
      if (wake !== null) clearTimeout(wake);
      wake = null;
      const wakeAt = shareProgressWakeAt(next);
      if (wakeAt !== null)
        wake = setTimeout(
          () => {
            wake = null;
            dispatch({ type: "tick", now: Date.now() });
          },
          Math.max(0, wakeAt - Date.now())
        );
    }
    // Hidden again — by the tick, a dismiss, or a settle with nothing to show:
    // let every `send()` waiting on the flash resolve. Checked on every
    // dispatch, not only on a change, so a dismiss while already hidden can
    // never strand a waiter.
    if (next.phase === "hidden" && waiters.length > 0) {
      const pending = waiters;
      waiters = [];
      for (const resolve of pending) resolve();
    }
  };
  return {
    dispatch,
    /** Resolves once the modal is hidden — at once if it already is. */
    hidden: (): Promise<void> =>
      state.phase === "hidden"
        ? Promise.resolve()
        : new Promise((resolve) => {
            waiters.push(resolve);
          }),
  };
}
