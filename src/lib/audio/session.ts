/**
 * The audio lifecycle arbiter.
 *
 * Two things make sound on this screen — a recorded take and the microphone —
 * and only one of them may be live at a time. Before this existed, that rule
 * was spelled out as `stopX()` calls scattered across every handler in `App`,
 * so each new handler was one more chance to forget one, and every `await`
 * between "start playing" and "here is the handle" was a race nobody was
 * watching.
 *
 * The rules, stated once:
 *
 *   - Claiming the floor stops whatever held it.
 *   - The microphone outranks playback. `claim("mic")` always succeeds;
 *     `claim("take")` is refused while the microphone is live.
 *   - The session never stops the microphone itself. Abandoning a take is
 *     always a named call in the hook, never a side effect of a play tap.
 *   - A handle that arrives after its claim was superseded is stopped here,
 *     rather than handed back to a caller who might forget.
 *
 * `claim`, `release` and `stopAll` are synchronous and allocation-free on
 * purpose: they run inside tap handlers *before* `getUserMedia` and
 * `resumeAudioContext`, and an `await` in front of either spends the iOS user
 * activation both of them need.
 *
 * Pure and DOM-free, so the races it exists to prevent are reproducible in
 * plain Node — see `tests/audio-session.test.ts`. That is why it lives in
 * `lib/audio/` rather than beside its hook: it holds no browser reference and
 * calls no browser API, so the arbitration is testable without a renderer.
 * `hooks/use-audio-session.ts` is the browser wiring around it, and is where
 * anything that needs an element or a context belongs.
 */

export type SourceKind = "take" | "mic";

/** Anything the arbiter can silence. Deliberately not a DOM type. */
export interface Stoppable {
  stop: () => void;
}

export interface AudioSession {
  /** What holds the floor right now, or `null` if nothing does. */
  readonly live: SourceKind | null;
  /**
   * Stop whatever is live and open a request for the floor.
   *
   * Returns a token identifying this request, or `null` when the request is
   * refused because the microphone holds the floor.
   */
  claim: (kind: SourceKind) => number | null;
  /** Whether `token` still names the current request. */
  isCurrent: (token: number) => boolean;
  /**
   * Adopt a handle built for `token`.
   *
   * Returns `false` when the request was superseded while the handle was
   * being built — in which case the handle is stopped here, because a caller
   * that ignores the result must still not be able to leak a live source.
   */
  settle: (token: number, handle: Stoppable) => boolean;
  /** Give up a token that never settled a handle: a load failed, or the clip ended. */
  release: (token: number) => void;
  /** Stop whatever is live and invalidate every outstanding token. */
  stopAll: () => void;
}

export function createAudioSession(): AudioSession {
  let generation = 0;
  let liveKind: SourceKind | null = null;
  let liveHandle: Stoppable | null = null;

  /** Drop the current holder without stopping it, and invalidate its token. */
  function clear(): void {
    liveHandle = null;
    liveKind = null;
    generation++;
  }

  return {
    get live() {
      return liveKind;
    },

    claim(kind) {
      // The microphone outranks playback and nothing outranks the microphone.
      // This is an invariant rather than a matter of which buttons happen to
      // be rendered, so a take can never start under a live recording.
      if (liveKind === "mic" && kind !== "mic") return null;
      liveHandle?.stop();
      liveHandle = null;
      liveKind = kind;
      return ++generation;
    },

    isCurrent(token) {
      return token === generation;
    },

    settle(token, handle) {
      if (token !== generation) {
        handle.stop();
        return false;
      }
      liveHandle = handle;
      return true;
    },

    release(token) {
      if (token !== generation) return;
      clear();
    },

    stopAll() {
      // `liveHandle` is null while the microphone holds the floor: the session
      // releases the mic's *claim* here, never the microphone itself.
      liveHandle?.stop();
      clear();
    },
  };
}
