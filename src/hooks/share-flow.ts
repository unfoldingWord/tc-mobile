import { useCallback, useEffect, useRef, useState } from "react";

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
 * WebView may expose no Web Share at all (#336). The flow below is the same
 * either way; only the two gates and the one call at the end consult the route.
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
 * `nothing`: there was no recorded audio to share. `failed`: encoding, the share
 * sheet, or an unsupported browser.
 */
export type ShareError = "nothing" | "failed";

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
 */
interface PreparedShare {
  readonly file: File;
  readonly missing: number;
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

export interface UseShareFlow {
  readonly status: ShareStatus;
  readonly error: ShareError | null;
  /** Units left out of the prepared File (segments or chapters). 0 until ready. */
  readonly missing: number;
  /**
   * Tap 1: run `build` to encode and stash the File for the send gesture. Never
   * rejects — a reason surfaces through `error`.
   */
  prepare: (build: BuildShareFile) => Promise<void>;
  /**
   * Tap 2: hand the stashed File to the OS share sheet. MUST be called straight
   * from a user gesture: it calls `navigator.share` with no await before it, so
   * the activation the platform requires is still live. The caller must not await
   * anything before `send()` inside the same gesture.
   */
  send: () => Promise<ShareOutcome>;
  /** Drop any prepared file and return to idle (menu close, unmount). */
  reset: () => void;
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
  // What tap 1 prepared, waiting for the send gesture. A ref, not state, so
  // `send` reads it synchronously inside the gesture — before any render — and
  // the sheet call keeps the activation the tap granted. `staged` is non-null on
  // the native route only: the file is already in the app cache by then, so tap
  // 2 is one plugin call on both routes (George R5 P2).
  const armedRef = useRef<{ file: File; staged: StagedShare | null } | null>(
    null
  );
  // A generation token invalidating an in-flight `prepare`. Both unmount AND
  // `reset` bump it, so a prepare that resolves after the screen is gone (Back
  // mid-encode) or after the menu was closed mid-gather does not `setState` or
  // arm a File behind a closed menu. The build awaits per unit, and the menu's
  // close/scrim stay live during those yields, so this race is reachable.
  const runIdRef = useRef(0);
  // Re-entry guard for tap 1: a second tap before the first render commits must
  // not start a second (expensive) encode.
  const preparingRef = useRef(false);
  // Re-entry guard for tap 2: `navigator.share` is only ever in flight once. A
  // double-tap (or two clicks before the OS sheet paints) must not open a second
  // share of the same File — the second's rejection would be classified `failed`
  // and drop the armed File out from under the first. Mirrors `use-erase-segment`'s
  // double-tap guard, which exists for exactly this reason.
  const sendingRef = useRef(false);
  // The in-flight prepare's abort handle (B8). Bumping the run token makes a
  // late result ignored; aborting is what stops the worker from finishing an
  // encode nobody will read. Both happen together in `reset` and on unmount.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      runIdRef.current += 1;
      abortRef.current?.abort();
      // The screen is gone; a staged file armed for a send that will never come
      // has no reader. Same fire-and-forget as `reset`.
      const armed = armedRef.current;
      armedRef.current = null;
      if (armed?.staged != null) void nativeShare.discard(armed.staged);
    },
    []
  );

  const prepare = useCallback(async (build: BuildShareFile): Promise<void> => {
    // Already encoding, or a File is already armed: ignore. (The screen hides the
    // prepare control while `ready`, so this is a re-entry backstop.)
    if (preparingRef.current || armedRef.current !== null) return;
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
    setStatus("preparing");
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
      armedRef.current = { file, staged };
      setMissing(prepared.missing);
      setStatus("ready");
    } catch (cause) {
      // A stale run's rejection — including the AbortError its own cancel
      // produced — is not this screen's news.
      if (!current()) return;
      console.error("Preparing the share failed", cause);
      setError("failed");
      setStatus("idle");
    } finally {
      // Only clear the guard for the run that still owns it. A stale run whose
      // token was bumped by `reset` must NOT release a newer run's guard, or a
      // further tap would start a third full encode over the same source.
      if (current()) {
        preparingRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
      }
    }
  }, []);

  const send = useCallback(async (): Promise<ShareOutcome> => {
    // A share is already in flight: ignore this tap and leave the File armed, so
    // a double-tap cannot open a second share whose rejection drops the File.
    if (sendingRef.current) return "retry";
    const armed = armedRef.current;
    if (armed === null) {
      // Reachable only through a guard hole (ready with no armed File); surface it
      // rather than no-op silently behind a "Share now" that does nothing.
      setError("failed");
      setStatus("idle");
      return "failed";
    }
    // Take ownership of the armed value SYNCHRONOUSLY, before any await. From
    // here the staged cache file belongs to this send, not to `armedRef` — so a
    // `reset()` or an unmount while the chooser is up cannot discard the file
    // the chooser is holding (Frank R6 P2). Deleting a staged file mid-handoff
    // is earlier than the deletion the rest of this module already refuses to
    // do: the recipient has not merely failed to finish, it has not started.
    // The `retry` arm below puts it back.
    armedRef.current = null;
    sendingRef.current = true;
    // A reset/unmount while the sheet is open must not write state afterwards.
    const runId = runIdRef.current;
    const current = () => runId === runIdRef.current;
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
      // `armedRef` was cleared on entry; the file went to the OS.
      setStatus("idle");
      setMissing(0);
      return "sent";
    } catch (cause) {
      const outcome = classifyShareError(cause, hadActivation);
      if (outcome === "retry") {
        // Activation was spent — the File still stands, so put it back and stay
        // `ready` so another tap can hand it over. Not a failure the translator
        // should see. Only if this run still owns the flow: if a newer one has
        // taken over, this staged file is nobody's and goes rather than leaking.
        if (current()) armedRef.current = armed;
        else if (armed.staged !== null) void nativeShare.discard(armed.staged);
        return "retry";
      }
      // A newer run owns the flow: don't touch its state and don't let the caller
      // act on this stale settle.
      if (!current()) return "superseded";
      if (outcome === "failed") console.error("Sharing failed", cause);
      // Dismissed or a real failure: end the flow for the run that still owns it.
      // The staged cache file is already gone — `nativeShare.send` removes its
      // own directory on a rejection, because a refused chooser is the one piece
      // of evidence that nothing received it. `armedRef` was cleared on entry.
      setStatus("idle");
      setMissing(0);
      if (outcome === "failed") setError("failed");
      return outcome;
    } finally {
      sendingRef.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    // Bump the token so an in-flight prepare (mid-gather) bails instead of arming
    // a File behind the now-closed menu, and abort so one mid-encode stops the
    // worker rather than finishing for nobody.
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    // A file already staged in the cache for a share that is now abandoned has
    // no reader and never will, so it goes. Fire-and-forget: `reset` runs from a
    // scrim tap and must not wait on the filesystem, and `discard` never
    // rejects. NOT `sendingRef` — that is cleared only by the send it belongs
    // to. Clearing it here would let a second tap open a second chooser over the
    // same file while the first is still up, which is the double-tap the guard
    // exists for (George R5 P2, in part: the rest is that `send` is now short).
    const armed = armedRef.current;
    armedRef.current = null;
    if (armed?.staged != null) void nativeShare.discard(armed.staged);
    preparingRef.current = false;
    setStatus("idle");
    setError(null);
    setMissing(0);
  }, []);

  return { status, error, missing, prepare, send, reset };
}
