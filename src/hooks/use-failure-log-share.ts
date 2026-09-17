import { useCallback, useEffect, useRef, useState } from "react";

import { formatFailureLog } from "@/lib/failure-text";
import { readFailures } from "@/lib/storage/failures";
import { reportFailure } from "./report-failure";
import {
  classifyShareError,
  type ShareError,
  type ShareOutcome,
  type ShareStatus,
} from "./share-flow";
import {
  type StagedShare,
  nativeShare,
  readShareEnvironment,
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
 * The two answers are THUNKS, and that is load-bearing (Frank, takeover round
 * 2). An eagerly built capability object asks the WebView both questions before
 * the decision is even made, which makes "native asks the WebView nothing" false
 * in the only place it matters: a WebView whose `canShare` throws — the class of
 * WebView this whole native route exists for (#336) — would take the native
 * route down with it, for an answer that route never reads. Lazy, the claim is a
 * property of the function below rather than a comment above it, and a test can
 * hold it to it.
 */
export interface LogShareCapabilities {
  /** Running inside the Capacitor shell (the APK / the iOS app). */
  readonly native: boolean;
  /** The browser has `navigator.share`. */
  readonly webShare: boolean;
  /** Asks `navigator.canShare` about each shape, or `null` if it has none. */
  readonly canShare: {
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
  if (!caps.webShare) return "unsupported";
  if (caps.canShare === null) return "text";
  if (caps.canShare.file()) return "file";
  return caps.canShare.text() ? "text" : "unsupported";
}

export interface UseFailureLogShare {
  readonly status: ShareStatus;
  readonly error: ShareError | null;
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
  /** Invalidates an in-flight prepare (panel close, unmount). */
  const runId = useRef(0);
  /** Re-entry guard for tap 2: one share in flight at a time. */
  const sending = useRef(false);
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
    if (armed.current !== null) return;
    // Fail before the read, not after: a platform that cannot share this in any
    // shape should not pay for an IndexedDB open first. `native` needs no Web
    // Share of its own, so the probe at this gate is the ROUTE, not
    // `navigator.share` (Frank, this round) — inside the shell there is nothing
    // here to fail on.
    const env = readShareEnvironment();
    if (!env.native && !env.webShare) {
      setError("failed");
      return;
    }
    const id = (runId.current += 1);
    const current = () => id === runId.current;
    const controller = new AbortController();
    aborter.current = controller;
    setError(null);
    setStatus("preparing");
    try {
      const entries = await readFailures();
      if (!current()) return;
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
      // and unit-tested; what is left here is carrying out its answer.
      const canShareFiles = env.canShareFiles;
      const shape = selectLogShareShape({
        native: env.native,
        webShare: env.webShare,
        // Neither thunk runs on the native route — that is the point of them
        // being thunks. `readShareEnvironment` has already read whether
        // `navigator.canShare` EXISTS, which is a property lookup and not a
        // call into the WebView's implementation.
        canShare:
          canShareFiles === null
            ? null
            : {
                file: () => canShareFiles(file),
                text: () => navigator.canShare({ text }),
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
      if (current() && aborter.current === controller) aborter.current = null;
    }
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
    // Read immediately before `share`: whether activation is live decides how a
    // NotAllowedError reads. See `classifyShareError`.
    const hadActivation = navigator.userActivation?.isActive ?? false;
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
      // dismissed chooser from a used one. It is reported as `sent` anyway, and
      // that is safe HERE for the reason it is safe for Share Chapter: nothing
      // is consumed by sending. The log is still on the phone, the count is
      // unchanged, and Clear is a separate deliberate gesture.
      return "sent";
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
  }, []);

  const reset = useCallback(() => {
    runId.current += 1;
    aborter.current?.abort();
    const stale = armed.current;
    armed.current = null;
    // Same as the unmount arm: a staged file nobody will send is dropped rather
    // than left in the OS cache.
    if (stale?.kind === "native") void nativeShare.discard(stale.staged);
    setStatus("idle");
    setError(null);
  }, []);

  return { status, error, prepare, send, reset };
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
