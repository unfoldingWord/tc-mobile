import { useCallback, useEffect, useRef, useState } from "react";

import { formatFailureLog } from "@/lib/failure-text";
import {
  getLogGeneration,
  readFailureLog,
  useLogGeneration,
} from "./failure-log";
import { reportFailure } from "./report-failure";
import {
  classifyShareError,
  resolveSendOutcome,
  type ShareError,
  type ShareOutcome,
  type ShareStatus,
} from "./share-flow";
import {
  type ShareEnvironment,
  type StagedShare,
  isNativeShell,
  nativeShare,
  readShareEnvironment,
  readSharePlatform,
  resolveProvesDelivery,
} from "./share-target";

/**
 * What the platform will take the log as, read at prepare time.
 *
 * `canShare` is `null` for a browser that has no `navigator.canShare` at all,
 * which is a Web Share **Level 1** browser — and not the same statement as a
 * `canShare` that answered no. Carried as one nullable object rather than two
 * nullable booleans so the two questions cannot be answered from different
 * platforms.
 *
 * Everything about the WEB platform is a THUNK, and that is load-bearing (Frank,
 * takeover rounds 2 and 5). An eagerly built capability object asks the WebView
 * its questions before the decision is even made, which makes "native asks the
 * WebView nothing" false in the only place it matters: a WebView whose `share`
 * or `canShare` is a throwing getter — the class of WebView this whole native
 * route exists for (#336) — would take the native route down with it, for
 * answers that route never reads. Only `native` is eager, because it is the one
 * question answered without touching the WebView at all (`isNativeShell`).
 *
 * Lazy, the claim is a property of the function below rather than a comment
 * above it, and a test can hold it to it.
 */
export interface LogShareCapabilities {
  /** Running inside the Capacitor shell (the APK / the iOS app). */
  readonly native: boolean;
  /** Whether the browser has `navigator.share`. */
  readonly webShare: () => boolean;
  /**
   * Asks `navigator.canShare` about each shape — or resolves to `null` for a
   * browser that has no `navigator.canShare` at all, which is Web Share
   * **Level 1** and NOT the same statement as a `canShare` that answered no.
   */
  readonly canShare: () => {
    readonly file: () => boolean;
    readonly text: () => boolean;
  } | null;
}

/**
 * Which shape the log goes out as: staged through the native plugin, as a
 * `text/plain` File through Web Share, as plain text through Web Share, or not
 * at all.
 *
 * The whole point of extracting it: this is the decision both earlier review
 * rounds found a bug in, and the hook around it is React + browser glue this
 * repo has no renderer to exercise (the constraint `tests/share-flow.test.ts`
 * documents). Four rules, each paid for:
 *
 *  1. **Native wins first, and asks the WebView nothing** (Frank, this round).
 *     `share-target.ts` exists because the first external tester's Android APK
 *     failed every share while the same build worked in a browser: a WebView
 *     may expose no Web Share at all (#336). Gating the log on `navigator.share`
 *     meant the facilitator on the training's own build — an APK and a
 *     TestFlight app — could never send it. Same defect as round 1's, one layer
 *     further out: a capability the log does not need was made a precondition.
 *  2. **No Web Share and not native is unsupported.** Said before the IndexedDB
 *     read, not after it.
 *  3. **A File only on an explicit yes** (Frank, round 2). `canShare` arrived
 *     with Web Share Level 2, which is also what added file sharing, so an
 *     ABSENT `canShare` means files are unavailable — not unknown-but-probably.
 *     Unknown support takes the shape every Web Share browser has: text.
 *  4. **Text is the fallback, not the failure** (George, round 1). A text share
 *     is worse than an attachment and incomparably better than an exit that
 *     does not open. Only a `canShare` that refuses BOTH shapes is unsupported:
 *     that is a standing refusal no retry clears, so it belongs on screen.
 */
export function selectLogShareShape(
  caps: LogShareCapabilities
): "native" | "file" | "text" | "unsupported" {
  if (caps.native) return "native";
  if (!caps.webShare()) return "unsupported";
  const canShare = caps.canShare();
  if (canShare === null) return "text";
  if (canShare.file()) return "file";
  return canShare.text() ? "text" : "unsupported";
}

export interface UseFailureLogShare {
  readonly status: ShareStatus;
  readonly error: ShareError | null;
  /**
   * See {@link UseShareFlow.sendUnconfirmed} — the identical field, on the
   * identical policy, for this hook's own `send()` (Frank at `238820a` P2,
   * #491): fixing `send()` to return `"unproven"` on an unconfirmed native
   * resolve (rather than an unconditional `"sent"`) closed George r2 P2-3's
   * hole in the RETURN VALUE, but neither caller — `FailureLogPanel`,
   * `SendLogControl` — read that return value for anything but whether to
   * close, so an unproven send still redrew a plain idle control with
   * nothing telling it apart from one that was never tried. Wired the same
   * way as chapter/book: true after an `unproven` settle, cleared at the
   * start of a fresh `prepare()` and by `reset()`.
   */
  readonly sendUnconfirmed: boolean;
  /**
   * Tap 1: read the log, render it, and arm the send gesture. Never rejects —
   * a reason surfaces through `error`.
   */
  prepare: () => Promise<void>;
  /** Tap 2: hand the armed payload to the OS share sheet. Must be called
   * straight from a user gesture — the sheet call, `navigator.share` in a
   * browser or the Share plugin inside the shell, runs with no await before it,
   * so the activation the web platform requires is still live. */
  send: () => Promise<ShareOutcome>;
  /** Drop anything armed and return to idle (panel close, unmount). */
  reset: () => void;
}

/**
 * Carry the failure log off the phone (#205).
 *
 * The log is durable, which makes it retrievable by a maintainer holding the
 * phone. That is not the situation the October training is: the phone is in a
 * translator's hand in Nairobi and the maintainer is not in the room. So the
 * log needs the same exit every recording has — the OS share sheet, which on
 * both platforms reaches mail, a messaging app, or a file the facilitator can
 * collect later, with no network of our own and no telemetry.
 *
 * ── What it DOES reuse: the share target (Frank, takeover round 1) ──
 *
 * WHERE the payload goes is `share-target.ts`'s decision and is the same one
 * every other share makes: the Capacitor plugin inside the native shell, Web
 * Share in a browser. That module exists because the first external tester's
 * Android APK failed every share while the same build worked in a browser — an
 * Android System WebView may expose no Web Share at all (#336) — and the
 * October training runs on exactly those builds, an APK and a TestFlight app.
 * A log gated on `navigator.share` would therefore have been unsendable on the
 * one platform it was written for.
 *
 * ── Why this does NOT reuse `useShareFlow` (George #5, round 1) ──
 *
 * It did, and that was the bug. `useShareFlow` is a FILE share: it gates on
 * `navigator.canShare({ files: [file] })` and, when that is false, sets
 * `error: "failed"` and never arms tap 2. That gate is right for an MP3 or a
 * zip. For `text/plain` it is a different capability question with a different
 * answer — iOS has historically not accepted every type in a file share — and
 * `canShare` is a standing refusal that no number of retries changes. The
 * failure mode was therefore: the one exit the log has refuses, permanently, on
 * the platform this ships to first. That the MP3 and zip shares pass their gate
 * is not evidence a text file passes its own.
 *
 * So the log gets its own two-gesture flow, which is small because the log is
 * cheap to build, and which **falls back to `navigator.share({ text })`** when a
 * file share is not on offer. Sharing text rather than a file is worse — the
 * recipient gets a message body instead of an attachment — and it is
 * incomparably better than an exit that does not open.
 *
 * The two-gesture split is kept for the reason `share-flow.ts` documents: iOS
 * revokes a tap's activation the moment the call stack awaits, and tap 1 here
 * awaits an IndexedDB open, which on a cold start is arbitrarily slow.
 *
 * `classifyShareError` is reused rather than reimplemented — the
 * `AbortError`-vs-`NotAllowedError`-with-activation reading is subtle and there
 * should be one copy of it.
 */
export function useFailureLogShare(): UseFailureLogShare {
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [error, setError] = useState<ShareError | null>(null);
  // See UseFailureLogShare.sendUnconfirmed's own docblock.
  const [sendUnconfirmed, setSendUnconfirmed] = useState(false);
  /**
   * What tap 1 armed. A ref, not state, so `send` reads it synchronously inside
   * the gesture — before any render — and the `navigator.share` call keeps the
   * activation the tap granted.
   *
   * `kind` records which shape the platform accepted at prepare time, so tap 2
   * does no capability work of its own.
   */
  const armed = useRef<
    | { kind: "native"; staged: StagedShare }
    | { kind: "file"; file: File }
    | { kind: "text"; text: string }
    | null
  >(null);
  /**
   * Which version of the log {@link armed} was read from — `null` when nothing
   * is armed. See the effect at the bottom of this hook.
   *
   * Declared with the other refs rather than beside that effect because `reset`
   * clears it, and `reset` is defined above: a `const` referenced before its
   * declaration is a temporal-dead-zone hazard the moment anything calls it
   * during render, and `react-hooks/immutability` says so.
   */
  const armedGeneration = useRef<number | null>(null);
  /** Invalidates an in-flight prepare (panel close, unmount). */
  const runId = useRef(0);
  /** Re-entry guard for tap 2: one share in flight at a time. */
  const sending = useRef(false);
  /**
   * Re-entry guard for tap 1 — the twin of `useShareFlow`'s `preparingRef`, and
   * missing here until Frank found it in takeover round 4.
   *
   * A ref and set SYNCHRONOUSLY, because the only thing standing between two
   * taps is that no render happens in between: the panel keeps the prepare
   * control on screen and enabled while `preparing` paints, so a second tap
   * during the IndexedDB read (or a native stage) is ordinary use on a slow
   * phone, not an edge case. Without this both calls saw `armed === null`, the
   * second bumped `runId` and invalidated the first, and a first run that had
   * SUCCEEDED was discarded — with the screen reporting whatever the second one
   * hit.
   */
  const preparing = useRef(false);
  /** Aborts an in-flight native stage, the way `useShareFlow` does. */
  const aborter = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      runId.current += 1;
      aborter.current?.abort();
      // A staged file armed for a send that will never come has no reader, and
      // it sits in the OS cache until the OS reclaims it. Fire-and-forget: the
      // screen is gone and a cleanup failure is nobody's news. A send already in
      // flight owns its own staged file — `send` clears `armed` before it
      // awaits, so there is nothing here to reach into.
      const stale = armed.current;
      armed.current = null;
      if (stale?.kind === "native") void nativeShare.discard(stale.staged);
    },
    []
  );

  const prepare = useCallback(async (): Promise<void> => {
    // Already armed, already preparing, or a chooser is still up: ignore. All
    // three are the same statement — this run would take a run that is already
    // under way away from it.
    if (armed.current !== null || preparing.current || sending.current) return;
    preparing.current = true;
    const id = (runId.current += 1);
    const current = () => id === runId.current;
    const controller = new AbortController();
    aborter.current = controller;
    setError(null);
    // A fresh attempt is itself the acknowledgment of any prior unconfirmed
    // one — see `UseFailureLogShare.sendUnconfirmed`'s own docblock.
    setSendUnconfirmed(false);
    try {
      // INSIDE the try, probes included (Frank, takeover round 3). This function
      // promises never to reject — the panel and the crash screen both call it
      // as `void share.prepare()`, so a rejection is an unhandled one, and the
      // control it came from would sit there looking idle with no Notice under
      // it. Reading `navigator.share` or `navigator.canShare` off a WebView is
      // not a safe operation on the class of WebView this route exists for: a
      // throwing getter is exactly the shape that produced #336. Nothing between
      // the tap and the catch is assumed safe.
      const native = isNativeShell();
      // Read at most ONCE, and only if something asks (Frank, takeover round 5).
      // `isNativeShell` touches no Web Share API at all, so inside the shell
      // this never runs and a broken WebView cannot cost the native route the
      // send.
      let env: ShareEnvironment | null = null;
      const webEnv = (): ShareEnvironment => (env ??= readShareEnvironment());
      // Fail before the IndexedDB read, not after: a platform that cannot share
      // this in any shape should not pay for an open first. The gate is the
      // ROUTE, not `navigator.share` — inside the shell there is nothing here to
      // fail on.
      if (!native && !webEnv().webShare) {
        setError("failed");
        return;
      }
      setStatus("preparing");
      // ON THE LANE (George R3 P2-1). A render throw reports from
      // `componentDidCatch`, so its row is queued — possibly behind a transcode
      // sweep's one-per-clip cascade — and this screen's Send is the control the
      // runbook tells a facilitator to use BEFORE Restart. Reading off the lane
      // could hand over a file that does not contain the crash it was sent
      // about, or say "There is nothing to send now" while the crash is still in
      // memory; Restart would then land the row on a phone whose file has
      // already gone, and on a deterministic home-path throw Books never becomes
      // a second door.
      const { entries, generation: readAt } = await readFailureLog();
      if (!current()) return;
      // The version of the log this payload IS, taken from inside the same lane
      // op that produced the rows (George R5 P2-1). Stamped HERE rather than
      // when the payload is armed a few lines down, because everything between
      // is synchronous — and stamped from the read rather than from the render's
      // `generation`, which is a snapshot of whatever the last paint saw.
      armedGeneration.current = readAt;
      // The panel only renders Send while the log is non-empty, so an empty
      // read means it was cleared between the render and the tap.
      if (entries.length === 0) {
        setError("nothing");
        setStatus("idle");
        return;
      }
      const text = formatFailureLog(entries, __APP_VERSION__);
      const file = new File([text], failureLogFilename(), {
        type: "text/plain",
      });
      // The whole branch matrix is {@link selectLogShareShape}, which is pure
      // and unit-tested; what is left here is carrying out its answer. Nothing
      // below is evaluated on the native route — that is what the thunks are
      // for, and a test holds the function to it.
      const shape = selectLogShareShape({
        native,
        webShare: () => webEnv().webShare,
        canShare: () => {
          const canShareFiles = webEnv().canShareFiles;
          return canShareFiles === null
            ? null
            : {
                file: () => canShareFiles(file),
                text: () => navigator.canShare({ text }),
              };
        },
      });
      if (shape === "unsupported") {
        // Nothing a retry can change, so this is a failure the panel should
        // show rather than a button that loops.
        setError("failed");
        setStatus("idle");
        return;
      }
      if (shape === "native") {
        // The write into the app cache happens HERE, on tap 1, for the reason
        // `useShareFlow` documents: it is the slow half, this is the gesture
        // with a busy state on it, and tap 2 must stay one call. The log is a
        // few kilobytes rather than a book zip, so this is fast — but the
        // shape is the repo's, not a second one invented for a small file.
        const staged = await nativeShare.stage(file, controller.signal);
        if (!current()) {
          // Cancelled while staging, but the write finished first: the file is
          // nobody's now, so do not leave it in the cache.
          void nativeShare.discard(staged);
          return;
        }
        armed.current = { kind: "native", staged };
      } else if (shape === "file") {
        armed.current = { kind: "file", file };
      } else {
        armed.current = { kind: "text", text };
      }
      setStatus("ready");
    } catch (cause) {
      if (!current()) return;
      // Through the funnel, not to the console (Frank, this round). Sharing the
      // log is an ordinary consumer of the log, not the log's own write: the
      // recursion that makes `writeEntry` swallow its failure — a row about the
      // failure to append a row — does not exist here. A facilitator whose
      // export failed gets a phone that has recorded WHY, and it goes out with
      // the next attempt. `reportFailure` terminates in `console.error` itself,
      // so the maintainer's desk loses nothing.
      reportFailure(cause, "failure-log-share-prepare");
      setError("failed");
      setStatus("idle");
    } finally {
      // Only the run that still owns the flow releases the guard. A stale run —
      // one a `reset` or an unmount bumped past — must not clear a NEWER run's
      // guard, or a further tap would start a second prepare over the top of it,
      // which is the defect this guard was added for (`useShareFlow` carries the
      // same `if (current())` for the same reason).
      if (current()) {
        preparing.current = false;
        if (aborter.current === controller) aborter.current = null;
      }
    }
  }, []);

  const reset = useCallback(() => {
    runId.current += 1;
    // Nothing is armed after this, so nothing has a version. Cleared here rather
    // than in the effect so every path out — a panel close, an unmount, a send —
    // leaves the stamp in the same state a fresh mount has.
    armedGeneration.current = null;
    aborter.current?.abort();
    aborter.current = null;
    // Released HERE, not in the bailed-out run's `finally`: that run's `current()`
    // is false from the line above, so it deliberately leaves the guard alone —
    // and if `reset` did not clear it, a panel closed mid-prepare would leave tap
    // 1 dead for the life of the screen. `sending` is NOT cleared, for the reason
    // `useShareFlow.reset` gives: the send that owns a chooser is the only thing
    // allowed to release it.
    preparing.current = false;
    const stale = armed.current;
    armed.current = null;
    // Same as the unmount arm: a staged file nobody will send is dropped rather
    // than left in the OS cache.
    if (stale?.kind === "native") void nativeShare.discard(stale.staged);
    setStatus("idle");
    setError(null);
    setSendUnconfirmed(false);
  }, []);

  const send = useCallback(async (): Promise<ShareOutcome> => {
    // A share is already in flight: leave the payload armed so a double-tap
    // cannot open a second share whose rejection drops the first's.
    if (sending.current) return "retry";
    const payload = armed.current;
    if (payload === null) {
      // Reachable only through a guard hole (ready with nothing armed); surface
      // it rather than no-op behind a button that does nothing.
      setError("failed");
      setStatus("idle");
      return "failed";
    }
    // ── The drop, checked again HERE, synchronously, before anything leaves ──
    //
    // Frank R8 P2, and it was reproduced rather than reasoned about: the passive
    // effect below is the only thing that dropped a stale payload, and a tap in
    // the window between React committing the write's render and that effect
    // running beat it. In headless Chromium, with the failure and the tap in one
    // task, the armed one-entry File went to `navigator.share` and the drop ran
    // afterwards — the report left the phone missing the very failure it was
    // sent about, which is exactly the mismatch the generation exists to catch.
    //
    // `getLogGeneration()` and not the `generation` this render captured: the
    // captured value is the one that is provably a version behind in that window.
    //
    // The DROP ITSELF is `reset()`, the same call the effect makes — one code
    // path, not a second copy of it. That matters more than it looks: `reset`
    // also discards a staged native file, and a hand-rolled drop here would have
    // been the place that forgot to. The effect stays, because it is what
    // disarms the control when nobody taps at all.
    if (
      armedGeneration.current !== null &&
      getLogGeneration() !== armedGeneration.current
    ) {
      reset();
      return "superseded";
    }
    sending.current = true;
    // The staged file belongs to THIS send from here, taken synchronously
    // before any await — the property `share-handoff.ts` exists to prove. A
    // panel closed or an unmount while the chooser is up must not discard the
    // file the chooser is holding. The web shapes keep their payload armed
    // instead, because a spent activation (`retry`) is answered by another tap
    // handing over the same File.
    if (payload.kind === "native") armed.current = null;
    const id = runId.current;
    const current = () => id === runId.current;
    // Whether activation was live decides how a `NotAllowedError` reads (see
    // `classifyShareError`), so it is read immediately before `share` — and ONLY
    // on the web route, inside the try (Frank, takeover round 5). It is another
    // `navigator` read, the native chooser does not depend on it, and this
    // function has the same never-rejects contract `prepare` does: both callers
    // invoke it fire-and-forget.
    let hadActivation = false;
    try {
      // Exactly ONE call on either route, invoked synchronously — an async
      // function runs to its first await, and this call IS that boundary, so
      // the tap's activation is still valid where the platform wants one. The
      // native chooser is an Android Intent / a `UIActivityViewController`
      // started by the plugin, not by the WebView, so it needs no activation at
      // all; it is called in the same position anyway, so the two routes have
      // one shape.
      if (payload.kind === "native") {
        await nativeShare.send(payload.staged);
      } else {
        hadActivation = navigator.userActivation?.isActive ?? false;
        await navigator.share(
          payload.kind === "file"
            ? { files: [payload.file] }
            : { text: payload.text }
        );
      }
      if (!current()) return "superseded";
      armed.current = null;
      setStatus("idle");
      // On the native route a resolve does NOT prove the sheet was used —
      // `resolveProvesDelivery` documents why the plugin cannot tell a
      // dismissed chooser from a used one (the Android false-success path,
      // Frank a446708 P2). This USED to report `sent` unconditionally, on the
      // reasoning that nothing is consumed by sending: the log is still on
      // the phone, the count is unchanged, and Clear is a separate deliberate
      // gesture. That reasoning is true and beside the point (George r2 P2-3,
      // #491) — it argues sending twice is cheap, not that reporting an
      // unconfirmed resolve as a confirmed one is honest, and Share
      // Chapter/Book's own `unproven` outcome (`resolveSendOutcome`) exists
      // for exactly this platform/route combination, not a chapter-specific
      // one. Same policy here: `unproven` when this platform cannot vouch for
      // the resolve, `sent` otherwise — and `unproven` is NOT in
      // `FailureLogPanel`'s close-on-`sent`/`dismissed` set, so an unconfirmed
      // native resolve leaves the panel open the same way it leaves the
      // Share menus open. No gap to carry here (a failure-log payload has no
      // `missing`/`partial` count), so `partial` can never come back — only
      // `sent` or `unproven`.
      const proven = resolveProvesDelivery(
        payload.kind === "native" ? "native" : "web",
        readSharePlatform()
      );
      const settled = resolveSendOutcome(proven, undefined);
      // Frank at `238820a` P2 (#491): flag it the same way chapter/book do,
      // so the idle Send control still shows it once `status` returns to
      // idle — see `UseFailureLogShare.sendUnconfirmed`.
      if (settled === "unproven") setSendUnconfirmed(true);
      return settled === "unproven" ? "unproven" : "sent";
    } catch (cause) {
      const outcome = classifyShareError(cause, hadActivation);
      // Activation was spent — keep the payload armed and stay `ready` so
      // another tap can hand it over. Not a failure to show anyone. Unreachable
      // on the native route (its payload is already taken, and the plugin
      // rejects with a plain Error rather than a `NotAllowedError`), so the
      // guard says so rather than restoring a staged file the plugin has
      // already removed.
      if (outcome === "retry" && payload.kind !== "native") return "retry";
      if (!current()) return "superseded";
      if (outcome === "failed") {
        // Through the funnel for the same reason `prepare` does: a failed
        // export is exactly what a maintainer needs the log to have recorded.
        // Dismissals and supersessions are not failures and are not reported.
        reportFailure(cause, "failure-log-share-send");
      }
      armed.current = null;
      setStatus("idle");
      if (outcome === "failed") setError("failed");
      return outcome;
    } finally {
      sending.current = false;
    }
  }, [reset]);

  // ── An armed payload is only true while the ROWS it was read from are ──
  //
  // Tap 1 renders a snapshot of the log to a File; tap 2 hands that File over.
  // A failure landing in between leaves the person sending something that does
  // not match what the screen says — and at the ring's limit it is worse than
  // stale, because an append there also prunes, so the File is missing the
  // newest row AND still contains one that has been deleted. Re-arming costs one
  // tap and is the honest answer.
  //
  // **This lives in the flow, not in a surface, and that is the fix** (George R4
  // P2-1). It was written in `FailureLogPanel`, which meant every screen that
  // sends the log had to re-derive it — and the second one, `SendLogControl` on
  // the crash screen, did not. That is the screen the runbook tells a
  // facilitator to use FIRST, with `install-failure-listeners.ts`'s window
  // listeners still live and a module-scoped transcode sweep that `App`'s
  // unmount does not cancel still reporting into the log behind it. A guard a
  // new surface has to remember is a guard a new surface will forget; one here
  // cannot be missed, because there is no way to arm a payload without it.
  //
  // Keyed on the generation, never on the count: at the limit the count does not
  // move at all. `useLogGeneration` moves on every landed write and clear and on
  // nothing else — a routine foreground re-read leaves an armed share alone.
  //
  // **Only a READY payload is an armed snapshot** (George R5 P2-1). The first
  // version of this dropped on any non-idle status, which included `"preparing"`
  // — and `prepare` sets that BEFORE it awaits `readFailureLog()`, a read that
  // sits on the write lane by design. So any write landing during the read
  // reset the flow mid-prepare: `reset` bumped `runId`, `prepare` took its
  // `if (!current()) return` arm, and the control went back to the quiet Send
  // with no Notice at all — a tap that did nothing and said nothing, which is
  // the worst failure shape this screen has. On the crash screen the writer is
  // usually the transcode sweep that `App`'s unmount does not cancel, so every
  // retry could be cancelled by the next segment's report; but any writer does
  // it, and one is enough.
  //
  // Cancelling a prepare was never the point. A read still in flight is not a
  // snapshot of anything yet — it is the thing that will BECOME one, and it is
  // on the lane precisely so that it covers whatever is queued ahead of it. What
  // has to be dropped is a payload already in the person's hand that no longer
  // matches the log. That is `"ready"`, and only `"ready"`.
  //
  // A write that lands after the read still drops it: `armedGeneration` is
  // stamped with the version the rows came from, so the moment the status
  // becomes `"ready"` and the live generation disagrees, the payload goes.
  //
  // **TWO TRIGGERS, ONE DROP** (Frank R8 P2). This effect was the only trigger,
  // and a passive effect is not a guard against a TAP: between React committing
  // the render that moved the generation and this effect running, the armed
  // payload is still armed and `send` was still willing to hand it over. That is
  // not reasoning — it was reproduced in headless Chromium against the shipped
  // build, with the failure and the tap in one task, and the stale one-entry
  // File went to `navigator.share` while this effect ran a beat later. The e2e
  // case `a failure landing in the SAME TASK as tap 2 sends nothing` is that
  // reproduction, kept.
  //
  // So `send` now asks the same question synchronously, from
  // `getLogGeneration()` rather than the `generation` captured below — the
  // captured one is precisely what is a version behind in that window. The two
  // triggers call the SAME `reset()`, which is why there is no second copy of
  // the drop to keep in step (and why neither can forget to discard a staged
  // native file, which `reset` does and a hand-rolled drop would not have).
  //
  // This effect stays and is not redundant: it is what disarms the control when
  // NOBODY taps, so the screen stops offering a snapshot that is no longer true.
  // `send`'s check is what protects the tap itself. Neither covers the other.
  const generation = useLogGeneration();
  useEffect(() => {
    if (status !== "ready") return;
    if (armedGeneration.current === null) return;
    if (generation === armedGeneration.current) return;
    armedGeneration.current = null;
    reset();
  }, [generation, status, reset]);

  return { status, error, sendUnconfirmed, prepare, send, reset };
}

/**
 * The shared file's name.
 *
 * Dated and version-stamped, because a facilitator collecting these from a
 * roomful of phones ends up with a folder of them and "log.txt" nine times over
 * is not a folder anyone can use. Colons are stripped from the ISO timestamp —
 * they are illegal in a filename on Windows, where these will be read.
 */
function failureLogFilename(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `tc-mobile-log-${__APP_VERSION__}-${stamp}.txt`;
}
