/**
 * What pausing a take owes the recorder it finds (#58, George R1 P2-1).
 *
 * `pause()` used to answer this with one comparison — `recorder.state !==
 * "recording"` and return — which was right while its only caller was the Record
 * control. That control is rendered from React state, and a user tap keeps the
 * two aligned: nothing offers Pause unless React already says `"recording"`.
 *
 * #58 added a caller that fires from a native lifecycle event instead, where the
 * two can disagree. If the user agent has already moved the recorder to
 * `"paused"` under us by the time `pagehide` runs, the old guard skipped the
 * whole freeze — `recordingRef`, the elapsed bank, `clearTick()`,
 * `setState("paused")` — and returned silently, leaving the UI rendering a live
 * take, a ticking timer and a scope still folding analyser columns over a
 * recorder that is not capturing. The failure was a RETURN, so the caller's
 * try/catch could not see it either.
 *
 * Three states, three different debts, so the decision is a table here rather
 * than a widening chain of `if`s in the hook — pure, DOM-free and proven in
 * plain Node, the sibling of `pagehide.ts`.
 */

/**
 * `MediaRecorder.state`, re-declared rather than imported.
 *
 * The DOM's own `RecordingState` is exactly this union, but `lib/` compiles with
 * no DOM lib (`tsconfig.lib.json`, `npm run typecheck:lib`), so naming it here
 * would not resolve. The call site still ties the two together: `use-recorder.ts`
 * passes a real `recorder.state`, so a value added to the DOM type and not here
 * fails typecheck at that call rather than silently reading as "ignore" — the
 * same arrangement `close-plan.ts` uses for `RecorderState`.
 */
type NativeRecorderState = "inactive" | "recording" | "paused";

/**
 * What the hook does:
 *
 *   pause-and-freeze  call `MediaRecorder.pause()`, then freeze.
 *   freeze-only       do not call it — the recorder is already paused and a
 *                     second call throws `InvalidStateError` — but freeze.
 *   ignore            do nothing at all.
 *
 * "Freeze" is one indivisible thing, and skipping it is what P2-1 was: stop the
 * scope push, bank the elapsed span, clear the tick, and take the state to
 * `"paused"`.
 */
type PausePlan = "pause-and-freeze" | "freeze-only" | "ignore";

/**
 * Decide it.
 *
 * `inactive` is deliberately NOT this table's business. A recorder that went
 * inactive on its own is a #59 mic interruption, and `onInterrupted` owns it: it
 * takes the recorder to `"processing"`, where `stop()` still recovers the
 * chunks. Freezing to `"paused"` here would paint a Resume the recorder cannot
 * honour over a take that already has a working recovery path, and would race
 * the interruption handler for the same state.
 *
 * No `default:` arm on purpose: a state added to the union fails
 * `npm run typecheck:lib` here instead of silently reading as "ignore".
 */
export function pausePlan(state: NativeRecorderState): PausePlan {
  switch (state) {
    case "recording":
      return "pause-and-freeze";
    case "paused":
      return "freeze-only";
    case "inactive":
      return "ignore";
  }
}
